/**
 * The `PreToolUse` bridge that adjudicates gateway MCP calls.
 *
 * WHAT THESE PIN. `canUseTool` is never invoked for a tool named outright in
 * `allowedTools`, and the compiled profile grants the whole gateway family that
 * way — so before this bridge existed, not one connector, evidence or review
 * call was adjudicated or journaled, while `docs/security-posture.md` said the
 * opposite. Both engine facts underneath are measured, not assumed
 * (`docs/engine-baseline.md` §4.5-4.6, via the live probe).
 */
import { describe, expect, it, vi } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@crabgic/contracts";
import type { AdjudicationCallback } from "@crabgic/engine-core";
import {
  createGatewayAdjudicationHook,
  GATEWAY_TOOL_WIRE_PREFIX,
  isGatewayTool,
} from "./gateway-adjudication-hook.js";
import { createInMemoryAdjudicationAuditLog } from "./hooks.js";

/** The wire name a hook actually receives: dots normalized to underscores (baseline §4.6). */
const GATEWAY_TOOL = `${GATEWAY_TOOL_WIRE_PREFIX}contract_approve`;

function invoke(
  adjudicate: AdjudicationCallback,
  toolName: string,
  toolInput: Record<string, unknown> = {},
) {
  const audit = createInMemoryAdjudicationAuditLog();
  const [matcher] = createGatewayAdjudicationHook({ adjudicate, audit });
  const hook = matcher!.hooks[0]!;
  return {
    audit,
    run: () =>
      hook(
        {
          hook_event_name: "PreToolUse",
          tool_name: toolName,
          tool_input: toolInput,
          tool_use_id: "tu-1",
        } as never,
        "tu-1",
        { signal: new AbortController().signal } as never,
      ),
  };
}

describe("isGatewayTool", () => {
  it("matches the UNDERSCORED wire form, which is the only form a hook ever sees", () => {
    // THE TRAP this exists to avoid: the gateway advertises `contract.approve`
    // and the SDK's own warning quotes `contract.approve`, but the engine
    // normalizes the dot. A matcher on the advertised name matches nothing —
    // a control that looks installed and is not.
    expect(isGatewayTool(`${GATEWAY_TOOL_WIRE_PREFIX}contract_approve`)).toBe(true);
    expect(isGatewayTool(`${GATEWAY_TOOL_WIRE_PREFIX}run_status`)).toBe(true);
  });

  it("does not match another server's tools, or a bare tool", () => {
    expect(isGatewayTool("mcp__other__contract_approve")).toBe(false);
    expect(isGatewayTool("Bash")).toBe(false);
    expect(isGatewayTool("")).toBe(false);
  });

  it("builds its prefix from the sole-definition constant, never a typed literal", () => {
    expect(GATEWAY_TOOL_WIRE_PREFIX).toBe(`mcp__${GATEWAY_MCP_SERVER_NAME}__`);
  });
});

describe("createGatewayAdjudicationHook", () => {
  it("allows a gateway call the policy allows, and records it in the audit log", async () => {
    const adjudicate = vi.fn(async () =>
      Promise.resolve({ behavior: "allow" as const, updatedInput: { changeSetId: "cs-1" } }),
    );
    const { run, audit } = invoke(adjudicate, GATEWAY_TOOL, { changeSetId: "cs-1" });

    const output = await run();
    expect(adjudicate).toHaveBeenCalledOnce();
    // NO OPINION on allow, deliberately: a PreToolUse "allow" BYPASSES the
    // permission system, so returning one here would let this bridge override
    // the compiled profile's own deny entries. It can only ever deny.
    expect(output).toEqual({});
    // The audit half: an allowed gateway call is now IN the audit's scope, so
    // the PostToolUse mismatch check covers it too. Before this bridge it never
    // was, because nothing ever recorded an allowed decision for a gateway tool.
    expect(audit.hasAnyAllowedDecision(GATEWAY_TOOL)).toBe(true);
    // Recorded as the input that will ACTUALLY execute, not the policy's
    // canonicalized form — recording the latter would make every gateway call
    // look like an executed-vs-adjudicated mismatch and could abort workers over
    // a difference this bridge introduced itself.
    expect(audit.hasMatchingAllowedDecision(GATEWAY_TOOL, { changeSetId: "cs-1" })).toBe(true);
  });

  it("denies a gateway call the policy denies, passing the reason through", async () => {
    const adjudicate = vi.fn(async () =>
      Promise.resolve({ behavior: "deny" as const, message: "outside the envelope" }),
    );
    const output = await invoke(adjudicate, GATEWAY_TOOL).run();
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "outside the envelope",
      },
    });
  });

  it("FAILS CLOSED when the callback throws", async () => {
    const adjudicate = (() => {
      throw new Error("bus unavailable");
    }) as unknown as AdjudicationCallback;
    const output = (await invoke(adjudicate, GATEWAY_TOOL).run()) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("failing closed");
  });

  it("FAILS CLOSED when the callback rejects", async () => {
    const adjudicate = (() => Promise.reject(new Error("nope"))) as unknown as AdjudicationCallback;
    const output = (await invoke(adjudicate, GATEWAY_TOOL).run()) as {
      hookSpecificOutput: { permissionDecision: string };
    };
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("FAILS CLOSED when there is no callback at all", async () => {
    const output = (await invoke(
      undefined as unknown as AdjudicationCallback,
      GATEWAY_TOOL,
    ).run()) as {
      hookSpecificOutput: { permissionDecision: string };
    };
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("never leaves a FAILED adjudication to the engine's own decision", async () => {
    // The distinction that matters: on a successful allow, no opinion is
    // correct (the engine allow-lists it anyway, and an "allow" here would
    // bypass the deny list). On a FAILED adjudication, no opinion would mean
    // AUTO-APPROVED — the exact hole this bridge closes — so every failure mode
    // must produce an explicit deny.
    for (const broken of [
      () => {
        throw new Error("x");
      },
      () => Promise.reject(new Error("y")),
      undefined,
    ]) {
      const output = (await invoke(
        broken as unknown as AdjudicationCallback,
        GATEWAY_TOOL,
      ).run()) as { hookSpecificOutput?: { permissionDecision?: string } };
      expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    }
  });

  it("can only ever narrow: it emits no `allow` permissionDecision on any path", async () => {
    // Pinned as a property over both outcomes, because this is the invariant
    // that keeps a control from becoming a bypass.
    for (const decision of [
      { behavior: "allow" as const, updatedInput: {} },
      { behavior: "deny" as const, message: "no" },
    ]) {
      const output = (await invoke(async () => Promise.resolve(decision), GATEWAY_TOOL).run()) as {
        hookSpecificOutput?: { permissionDecision?: string };
      };
      expect(output.hookSpecificOutput?.permissionDecision).not.toBe("allow");
    }
  });

  it("leaves NON-gateway tools entirely alone — canUseTool already adjudicated them", async () => {
    // Adjudicating twice would journal two decisions for one call.
    const adjudicate = vi.fn(async () =>
      Promise.resolve({ behavior: "allow" as const, updatedInput: {} }),
    );
    const output = await invoke(adjudicate, "Bash", { command: "ls" }).run();
    expect(adjudicate).not.toHaveBeenCalled();
    expect(output).toEqual({});
  });

  it("treats a malformed tool_input as empty rather than throwing inside the engine's hook", async () => {
    const adjudicate = vi.fn(async () =>
      Promise.resolve({ behavior: "allow" as const, updatedInput: {} }),
    );
    const { run } = invoke(adjudicate, GATEWAY_TOOL, null as unknown as Record<string, unknown>);
    await expect(run()).resolves.toBeDefined();
    expect(adjudicate).toHaveBeenCalledWith(GATEWAY_TOOL, {}, expect.anything());
  });

  it("DENIES a nameless call rather than waving it through", async () => {
    // The earlier version returned no opinion here, which for a gateway tool
    // means auto-approved — a fail-OPEN that a test had codified as intended.
    // Unreachable today, which is precisely why it went unnoticed.
    const adjudicate = vi.fn(async () =>
      Promise.resolve({ behavior: "allow" as const, updatedInput: {} }),
    );
    for (const nameless of [undefined, "", 42]) {
      const output = (await invoke(adjudicate, nameless as unknown as string).run()) as {
        hookSpecificOutput?: { permissionDecision?: string };
      };
      expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    }
    expect(adjudicate).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED when the callback RESOLVES something malformed", async () => {
    // This used to throw outside the try/catch, which the engine turns into a
    // whole-turn stop: fail-closed, but with no audit record and a dead worker
    // instead of one denied call.
    for (const malformed of [undefined, null, {}, { behavior: "maybe" }, 7]) {
      const output = (await invoke(
        (() => Promise.resolve(malformed)) as unknown as AdjudicationCallback,
        GATEWAY_TOOL,
      ).run()) as { hookSpecificOutput?: { permissionDecision?: string } };
      expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    }
  });

  it("carries `interrupt` through, so a policy can still halt the worker on a gateway call", async () => {
    const output = (await invoke(
      async () => Promise.resolve({ behavior: "deny" as const, message: "halt", interrupt: true }),
      GATEWAY_TOOL,
    ).run()) as { continue?: boolean; stopReason?: string };
    expect(output.continue).toBe(false);
    expect(output.stopReason).toBe("halt");
  });
});
