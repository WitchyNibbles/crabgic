/**
 * The `PreToolUse` bridge that adjudicates gateway MCP calls AND the
 * rule-granted mutation-capable built-ins (`Bash`, `Edit`, `Write`).
 *
 * WHAT THESE PIN. `canUseTool` is never invoked for a tool named outright in
 * `allowedTools` (baseline §4.5), and — measured 2026-07-30, §4.7 — a
 * RULE-SHAPED allow entry (`Bash(git status:*)`) shadows it exactly the same
 * way. The compiled profile grants the gateway family by name and
 * `Bash`/`Edit`/`Write` by rule, so before this bridge covered them, not one
 * mutation-capable call was adjudicated or journaled either. All engine facts
 * underneath are measured, not assumed (`docs/engine-baseline.md` §4.5-4.7,
 * via the live probes).
 */
import { describe, expect, it, vi } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@crabgic/contracts";
import type { AdjudicationCallback } from "@crabgic/engine-core";
import {
  ADJUDICATED_BUILTIN_TOOLS,
  createToolAdjudicationHook,
  GATEWAY_TOOL_WIRE_PREFIX,
  isAdjudicatedTool,
  isGatewayTool,
} from "./tool-adjudication-hook.js";
import { createInMemoryAdjudicationAuditLog } from "./hooks.js";

/** The wire name a hook actually receives: dots normalized to underscores (baseline §4.6). */
const GATEWAY_TOOL = `${GATEWAY_TOOL_WIRE_PREFIX}contract_approve`;

function invoke(
  adjudicate: AdjudicationCallback,
  toolName: string,
  toolInput: Record<string, unknown> = {},
) {
  const audit = createInMemoryAdjudicationAuditLog();
  const [matcher] = createToolAdjudicationHook({ adjudicate, audit });
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

describe("isAdjudicatedTool", () => {
  it("covers exactly the tools the compiled profile grants BY RULE: the gateway family and Bash/Edit/Write", () => {
    // These are the tools whose allow entries shadow `canUseTool` (baseline
    // §4.5 for bare names, §4.7 for rule-shaped entries) — the tools that
    // would otherwise execute with no adjudication record at all.
    expect(isAdjudicatedTool(`${GATEWAY_TOOL_WIRE_PREFIX}contract_approve`)).toBe(true);
    expect(isAdjudicatedTool("Bash")).toBe(true);
    expect(isAdjudicatedTool("Edit")).toBe(true);
    expect(isAdjudicatedTool("Write")).toBe(true);
    expect(ADJUDICATED_BUILTIN_TOOLS).toEqual(new Set(["Bash", "Edit", "Write"]));
  });

  it("EXCLUDES tools the profile grants no rule for — the policy would default-deny them all", () => {
    // `createEnvelopeAdjudicationPolicy` denies any unlisted tool. The engine
    // grants read-only tools WITHOUT a rule, so covering them would journal a
    // meaningless deny verdict for every `Read`/`Glob`/`Grep` call and
    // black-hole them all whenever adjudication is unavailable — a control
    // added to close a hole must not break the worker it guards.
    expect(isAdjudicatedTool("Read")).toBe(false);
    expect(isAdjudicatedTool("Glob")).toBe(false);
    expect(isAdjudicatedTool("Grep")).toBe(false);
    expect(isAdjudicatedTool("TodoWrite")).toBe(false);
    expect(isAdjudicatedTool("Task")).toBe(false);
    expect(isAdjudicatedTool("mcp__other__contract_approve")).toBe(false);
    expect(isAdjudicatedTool("")).toBe(false);
  });
});

describe("createToolAdjudicationHook", () => {
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

  it("adjudicates a rule-granted BUILT-IN: an allowed Bash call is recorded and gets no opinion", async () => {
    // §4.7: a rule-shaped allow entry shadows `canUseTool` exactly like a bare
    // name, so before this hook covered Bash/Edit/Write the mutation-capable
    // tools executed with NO adjudication record and sat outside the
    // PostToolUse audit's scope entirely.
    const adjudicate = vi.fn(async () =>
      Promise.resolve({ behavior: "allow" as const, updatedInput: { command: "git status" } }),
    );
    const { run, audit } = invoke(adjudicate, "Bash", { command: "git status" });
    const output = await run();
    expect(adjudicate).toHaveBeenCalledWith("Bash", { command: "git status" }, expect.anything());
    expect(output).toEqual({});
    // The audit half: Bash is now IN the PostToolUse mismatch check's scope,
    // recorded as the input that will actually execute.
    expect(audit.hasMatchingAllowedDecision("Bash", { command: "git status" })).toBe(true);
  });

  it("RECORDS but does NOT act on a policy deny for a built-in — record-not-refuse, for each of Bash/Edit/Write", async () => {
    // The measured reason (baseline §4.8): the envelope policy is STRICTER
    // than the engine inside a matched rule — the engine allows
    // `git status 2>&1` under `Bash(git status:*)` while the policy's
    // unproven-metacharacter fail-closed denies it. Turning the policy's
    // verdict into a hook deny would refuse calls the engine grants (a live
    // worker-reliability regression, review F1), and returning no opinion
    // WITHOUT recording would false-abort the PostToolUse audit when the
    // engine then executes the call. So for built-ins the verdict is
    // journaled (by the bus, inside `adjudicate`) and the input is recorded
    // for the audit, and the ENGINE keeps deciding — behavior is byte-
    // identical to the pre-bridge engine evaluation.
    for (const [toolName, toolInput] of [
      ["Bash", { command: "npm run test 2>&1" }],
      ["Edit", { file_path: "/outside/owned/paths.ts" }],
      ["Write", { file_path: "/outside/owned/paths.ts" }],
    ] as const) {
      const adjudicate = vi.fn(async () =>
        Promise.resolve({ behavior: "deny" as const, message: "outside the envelope" }),
      );
      const { run, audit } = invoke(
        adjudicate,
        toolName,
        toolInput as unknown as Record<string, unknown>,
      );
      const output = await run();
      expect(adjudicate).toHaveBeenCalledOnce();
      expect(output).toEqual({});
      expect(audit.hasMatchingAllowedDecision(toolName, toolInput as Record<string, unknown>)).toBe(
        true,
      );
    }
  });

  it("still DENIES a built-in when adjudication itself is unavailable — no unrecorded mutation call may proceed", async () => {
    // Record-not-refuse presumes a record EXISTS. A throwing/rejecting/absent/
    // malformed adjudication produces neither a journal entry the caller can
    // trust nor an audit record, so the fail-closed posture holds: deny.
    for (const broken of [
      () => {
        throw new Error("bus down");
      },
      () => Promise.reject(new Error("nope")),
      undefined,
      () => Promise.resolve({ behavior: "maybe" }),
    ]) {
      const output = (await invoke(broken as unknown as AdjudicationCallback, "Bash", {
        command: "git status",
      }).run()) as { hookSpecificOutput?: { permissionDecision?: string } };
      expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    }
  });

  it("honors an explicit `interrupt` halt from the policy even for a built-in", async () => {
    // A routine deny verdict is divergence-prone (§4.8) and is not acted on;
    // `interrupt: true` is a policy explicitly demanding the worker halt,
    // which is a different statement and is carried through.
    const output = (await invoke(
      async () => Promise.resolve({ behavior: "deny" as const, message: "halt", interrupt: true }),
      "Bash",
      { command: "git status" },
    ).run()) as { continue?: boolean; stopReason?: string };
    expect(output.continue).toBe(false);
    expect(output.stopReason).toBe("halt");
  });

  it("leaves NON-adjudicated tools entirely alone — an opinion would black-hole them", async () => {
    // NOT because `canUseTool` covers them (that premise was measured false
    // for rule-granted tools, §4.7): because the envelope policy default-denies
    // any unlisted tool while the engine grants read-only tools without a rule,
    // so a deny-only opinion here would break every worker.
    const adjudicate = vi.fn(async () =>
      Promise.resolve({ behavior: "allow" as const, updatedInput: {} }),
    );
    for (const toolName of ["Read", "Glob", "Grep", "TodoWrite", "ToolSearch"]) {
      const output = await invoke(adjudicate, toolName, { file_path: "/x" }).run();
      expect(output).toEqual({});
    }
    expect(adjudicate).not.toHaveBeenCalled();
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
