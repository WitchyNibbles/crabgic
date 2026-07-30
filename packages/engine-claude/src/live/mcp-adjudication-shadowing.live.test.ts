/**
 * `mcp-adjudication-shadowing.live.test` — the AUTHORED probe the 2026-07-30
 * finding owes, for the two engine facts its fix depends on.
 *
 * WHAT WAS FOUND, AND HOW. Running a real worker for the first time, the Agent
 * SDK emitted, unprompted:
 *
 *   [CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] canUseTool will not be invoked for:
 *   mcp__<gateway>__*. Bare allowedTools entries auto-approve the whole
 *   tool before the callback is consulted. To gate every tool call, use a
 *   PreToolUse hook; or remove the bare names from allowedTools so they fall
 *   through to canUseTool.
 *
 * `compileEnvelope` grants the gateway family by naming those tools outright in
 * `allowedTools`, so phase 06's journal-first fail-closed `AdjudicationCallback`
 * never fires for a connector, evidence or review call. Recorded in
 * `docs/engine-baseline.md` §4.5 and `docs/security-posture.md`.
 *
 * WHY THIS FILE EXISTS RATHER THAN A FIX. The remedy is an engine claim — "a
 * PreToolUse hook gates every call, because hooks run before permission
 * evaluation" — and this repository's ground rule is that anything
 * engine-touching cites a probe, never a warning string and never memory. The
 * sibling `adjudication-bridge.live.test.ts` probed the same question for
 * `Bash` and could not have caught this, because the shadowing is a property of
 * the allow entry and MCP tools are granted by name. So this probe asks both
 * halves directly:
 *
 *   (a) `canUseTool` is NOT invoked for an MCP tool named in `allowedTools`
 *       — the finding, reproduced in this repository's own harness rather than
 *       inferred from a log line.
 *   (b) a `PreToolUse` hook IS invoked for that same call — the fact the fix
 *       rests on. If this fails, the hook is not the remedy and the fix has to
 *       change, which is exactly what a probe is for.
 *
 * WHAT THIS PROBE HAS ESTABLISHED SO FAR (three live runs, engine 2.1.218):
 *
 * - **(a) is confirmed, from the engine's own mouth.** Every run emits
 *   `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` naming `mcp__<gateway>__probe.echo`
 *   specifically. The SDK only emits that for a tool it has registered and whose
 *   permission it has evaluated, so the stub server connected, the tool existed,
 *   and the callback was ruled out for it. That is independent of whether the
 *   model chose to call it.
 * - **(b) is still OPEN, and this probe does not yet settle it.** On no run so
 *   far has the model actually invoked the stub tool: it reached for
 *   `ToolSearch` and `Bash` instead, then on a more directive prompt made no
 *   tool call at all. So the hook never had an MCP call to see. `hookCalls`
 *   being empty is NOT evidence that hooks miss MCP tools, and the assertions
 *   below are written so that distinction cannot be mistaken for a result.
 *
 * What it needs to close (b): a reliable way to make a `haiku` worker invoke a
 * stub MCP tool — likely a prompt with no alternative route, and the tool as the
 * ONLY enabled one so `ToolSearch`/`Bash` are not available to reach for. Until
 * then the fix in `docs/security-posture.md` stays owed rather than attempted,
 * because building a control on an unprobed engine claim is the thing this
 * repository's engine-fact-drift rule exists to prevent.
 *
 * Like every `*.live.test.ts` here it fails RED (never skips) without
 * `CRABGIC_LIVE=1`, so the `engine-live` job goes red rather than vacuously
 * green.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { GATEWAY_MCP_SERVER_NAME } from "@crabgic/contracts";
import {
  assertLiveEnabled,
  createLiveScratch,
  LIVE_GATEWAY_OVERRIDE,
  resolveWorkerAuthMaterial,
  runDirectQuery,
} from "./live-harness.js";

/** The stub gateway's one callable tool, under the wire name the engine gives it. */
const PROBE_TOOL = `mcp__${GATEWAY_MCP_SERVER_NAME}__probe.echo`;

/**
 * Whether the model genuinely INVOKED `toolName` — a real `tool_use` content
 * block whose `name` matches.
 *
 * Deliberately not a substring search over the message JSON, which the first
 * version of this probe used and which is satisfied by the PROMPT: the prompt
 * names the tool, the transcript echoes the prompt, and the check passes without
 * a single tool call. That made a "the tool was reached" precondition vacuous,
 * which is the one thing a precondition must not be.
 */
function invokedToolNames(messages: readonly SDKMessage[]): readonly string[] {
  const names: string[] = [];
  for (const message of messages) {
    if (message.type !== "assistant") continue;
    const content = (message as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const candidate = block as { type?: unknown; name?: unknown };
      if (candidate.type === "tool_use" && typeof candidate.name === "string") {
        names.push(candidate.name);
      }
    }
  }
  return names;
}

function invokedTool(messages: readonly SDKMessage[], toolName: string): boolean {
  for (const message of messages) {
    if (message.type !== "assistant") continue;
    const content = (message as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const candidate = block as { type?: unknown; name?: unknown };
      if (candidate.type === "tool_use" && candidate.name === toolName) return true;
    }
  }
  return false;
}

beforeAll(() => {
  assertLiveEnabled();
});

describe("MCP adjudication shadowing (engine fact, live)", () => {
  it(
    "does NOT invoke canUseTool for an MCP tool granted by a bare allowedTools entry",
    { timeout: 180_000 },
    async () => {
      const scratch = await createLiveScratch();
      try {
        const canUseToolCalls: string[] = [];
        const result = await runDirectQuery(resolveWorkerAuthMaterial(), {
          prompt: `Use the ${PROBE_TOOL} tool now, with text set to "shadow-probe". Do not search for tools and do not use Bash; the tool is already available to you. Call it, then stop.`,
          cwd: scratch.worktreePath,
          configDir: scratch.configDir,
          homeDir: scratch.homeDir,
          tmpDir: scratch.tmpDir,
          // Granted the way the compiled profile grants it: by name.
          allowedTools: [PROBE_TOOL],
          allow: [PROBE_TOOL],
          mcpServers: { [GATEWAY_MCP_SERVER_NAME]: LIVE_GATEWAY_OVERRIDE },
          strictMcpConfig: true,
          canUseTool: (toolName) => {
            canUseToolCalls.push(toolName);
            return Promise.resolve({ behavior: "allow" as const, updatedInput: {} });
          },
          maxTurns: 6,
        });

        // INCONCLUSIVE, NOT FAILED, when the model never called the tool. The
        // difference matters: "the gate did not fire" and "nothing was gated"
        // look identical in a bare assertion and mean opposite things.
        expect(
          invokedTool(result.messages, PROBE_TOOL),
          `INCONCLUSIVE: the model did not invoke ${PROBE_TOOL} on this run, so this ` +
            `says nothing about which gate fires. Tools actually invoked: ` +
            `${JSON.stringify(invokedToolNames(result.messages))}. Steer the prompt or ` +
            `raise maxTurns; do NOT relax the assertion below.`,
        ).toBe(true);

        // THE FINDING. The callback is never consulted for this tool.
        expect(canUseToolCalls).not.toContain(PROBE_TOOL);
      } finally {
        await scratch.cleanup();
      }
    },
  );

  it(
    "DOES invoke a PreToolUse hook for that same MCP call — the fact the fix rests on",
    { timeout: 180_000 },
    async () => {
      const scratch = await createLiveScratch();
      try {
        const hookCalls: string[] = [];
        const result = await runDirectQuery(resolveWorkerAuthMaterial(), {
          prompt: `Use the ${PROBE_TOOL} tool now, with text set to "hook-probe". Do not search for tools and do not use Bash; the tool is already available to you. Call it, then stop.`,
          cwd: scratch.worktreePath,
          configDir: scratch.configDir,
          homeDir: scratch.homeDir,
          tmpDir: scratch.tmpDir,
          allowedTools: [PROBE_TOOL],
          allow: [PROBE_TOOL],
          mcpServers: { [GATEWAY_MCP_SERVER_NAME]: LIVE_GATEWAY_OVERRIDE },
          strictMcpConfig: true,
          hooks: {
            PreToolUse: [
              {
                // Every tool, so the probe measures whether MCP tools reach
                // hooks at all rather than whether one matcher syntax works.
                hooks: [
                  (input) => {
                    hookCalls.push(
                      typeof (input as { tool_name?: unknown }).tool_name === "string"
                        ? (input as { tool_name: string }).tool_name
                        : "(unnamed)",
                    );
                    return Promise.resolve({ continue: true });
                  },
                ],
              },
            ],
          },
          maxTurns: 6,
        });

        // Inconclusive unless the tool was genuinely invoked. The first run of
        // this probe recorded hook calls for `ToolSearch` and `Bash` and none
        // for the MCP tool — which looked like "hooks do not see MCP tools" and
        // was actually "the model went looking for the tool instead of calling
        // it". A probe that cannot tell those apart answers neither.
        expect(
          invokedTool(result.messages, PROBE_TOOL),
          `INCONCLUSIVE: the model did not invoke ${PROBE_TOOL} on this run. Hook calls ` +
            `observed: ${JSON.stringify(hookCalls)}. An empty list here means nothing was ` +
            `gated, NOT that hooks miss MCP tools.`,
        ).toBe(true);

        // THE FACT THE FIX NEEDS. If this is empty on a run where the tool WAS
        // invoked, a PreToolUse hook does not see MCP tool calls at the pinned
        // version, and the adjudication bridge needs a different remedy.
        expect(hookCalls).toContain(PROBE_TOOL);
      } finally {
        await scratch.cleanup();
      }
    },
  );
});
