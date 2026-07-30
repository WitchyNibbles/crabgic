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
 * WHAT THIS PROBE ESTABLISHED (live, engine 2.1.218):
 *
 * - **(a) `canUseTool` is shadowed — CONFIRMED.** Every run emits
 *   `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` naming the stub tool, and the callback is
 *   never invoked for it under either name it goes by. The SDK emits that
 *   warning only for a tool it has registered and whose permission it has
 *   evaluated, so this is measurement rather than inference.
 * - **(b) a `PreToolUse` hook DOES fire for that same MCP call — CONFIRMED.**
 *   The remedy the engine names is real, so the adjudication bridge can be
 *   rebuilt on it.
 * - **A third fact fell out, and it is the one most likely to bite:** the engine
 *   normalizes a dot in an MCP tool name to an underscore. The server advertises
 *   `probe.echo`, the SDK's warning quotes `probe.echo`, and the hook observes
 *   `probe_echo`. Every real gateway tool is dotted, so a hook matcher written
 *   against the advertised name matches NOTHING — a control that looks installed
 *   and is not, which is exactly the failure this probe exists because of.
 *
 * KNOWN FLAKY, AND THE FLAKE IS THE MODEL. Across eight live runs a `haiku`
 * worker invoked the stub tool roughly one time in eight, on identical options —
 * it answers in prose instead. `untilToolInvoked` retries the PRECONDITION up to
 * five times, which helps and does not fix it. A run that ends INCONCLUSIVE has
 * measured nothing; it is not a regression, and the assertions are worded so that
 * cannot be misread.
 *
 * Both facts above are nonetheless SETTLED, because each rests on a positive
 * observation and non-reproduction does not weaken one: (a) passed on a run where
 * the tool was genuinely invoked and `canUseTool` was still never consulted, and
 * (b) was observed directly — `hookCalls` contained the underscored wire name on
 * a run where the model did call the tool. What is unreliable is re-demonstrating
 * them on demand, not the facts.
 *
 * Getting here took eight live runs. The model kept reaching for
 * `ToolSearch`/`Bash` until those were denied (deny is catalog-removal, baseline
 * §4.2), and then the assertions spent three runs looking for a tool name the
 * engine never emits.
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

/**
 * The tools the model reached for instead of the one under test, denied so the
 * probe measures what it means to measure.
 *
 * Deny is catalog-removal rather than call-time refusal (`docs/engine-baseline.md`
 * §4.2), so these vanish from the model's list entirely and the stub tool is the
 * only way to answer the prompt. `Agent` is included because it aliases `Task`
 * (§4.1) and a subagent would be another escape route.
 */
const ALTERNATIVE_TOOLS: readonly string[] = [
  "ToolSearch",
  "Bash",
  "Agent",
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
];

/**
 * The stub gateway's one callable tool, in BOTH the names it goes by.
 *
 * ENGINE FACT, measured here 2026-07-30: the engine NORMALIZES a dot in an MCP
 * tool name to an underscore when it builds the wire name. The server advertises
 * `probe.echo`; the model invokes, and hooks observe, `..._probe_echo`. The
 * SDK's own shadowing warning, confusingly, quotes the DOTTED form.
 *
 * This is not a curiosity about the stub. Every real gateway tool is dotted —
 * `contract.approve`, `run.status`, `tracker.apply` — so anything matching tool
 * names at the hook layer must match the UNDERSCORED form or it will silently
 * match nothing. That is precisely the shape of bug this whole probe exists
 * because of, and it cost three inconclusive runs here: the assertions were
 * looking for a name the engine never emits.
 */
const PROBE_TOOL_ADVERTISED = `mcp__${GATEWAY_MCP_SERVER_NAME}__probe.echo`;
const PROBE_TOOL = `mcp__${GATEWAY_MCP_SERVER_NAME}__probe_echo`;

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
/**
 * Runs `attempt` until the model actually invokes `PROBE_TOOL`, up to `tries`.
 *
 * The model is the one part of this probe nobody can make deterministic: across
 * six live runs a `haiku` worker called the stub tool once and, on identical
 * options, declined to five times — it answers in prose instead. A hook cannot
 * observe a call that was never made, so without this the probe reports
 * INCONCLUSIVE far more often than it reports anything.
 *
 * This retries the PRECONDITION only. Every assertion about which gate fired
 * still runs exactly once, against a run where the tool genuinely was invoked;
 * nothing here makes a failing gate look like a passing one.
 */
async function untilToolInvoked(
  tries: number,
  attempt: () => Promise<{ readonly messages: readonly SDKMessage[] }>,
): Promise<{ readonly messages: readonly SDKMessage[]; readonly attempts: number }> {
  let last: { readonly messages: readonly SDKMessage[] } = { messages: [] };
  for (let index = 1; index <= tries; index += 1) {
    last = await attempt();
    if (invokedTool(last.messages, PROBE_TOOL)) return { ...last, attempts: index };
  }
  return { ...last, attempts: tries };
}

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
        const result = await untilToolInvoked(5, () =>
          runDirectQuery(resolveWorkerAuthMaterial(), {
            prompt: `Use the ${PROBE_TOOL_ADVERTISED} tool now, with text set to "shadow-probe". Do not search for tools and do not use Bash; the tool is already available to you. Call it, then stop.`,
            cwd: scratch.worktreePath,
            configDir: scratch.configDir,
            homeDir: scratch.homeDir,
            tmpDir: scratch.tmpDir,
            // Granted the way the compiled profile grants it: by name.
            allowedTools: [PROBE_TOOL, PROBE_TOOL_ADVERTISED],
            allow: [PROBE_TOOL, PROBE_TOOL_ADVERTISED],
            // Deny is catalog-REMOVAL (baseline §4.2), so this takes the escape
            // routes out of the model's tool list entirely. Earlier runs left them
            // in and the model reached for `ToolSearch`/`Bash` instead of the tool
            // under test, which made every run inconclusive.
            disallowedTools: [...ALTERNATIVE_TOOLS],
            mcpServers: { [GATEWAY_MCP_SERVER_NAME]: LIVE_GATEWAY_OVERRIDE },
            strictMcpConfig: true,
            canUseTool: (toolName) => {
              canUseToolCalls.push(toolName);
              return Promise.resolve({ behavior: "allow" as const, updatedInput: {} });
            },
            maxTurns: 6,
          }),
        );

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

        // THE FINDING. The callback is never consulted for this tool, under
        // either name it goes by.
        expect(canUseToolCalls).not.toContain(PROBE_TOOL);
        expect(canUseToolCalls).not.toContain(PROBE_TOOL_ADVERTISED);
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
        const result = await untilToolInvoked(5, () =>
          runDirectQuery(resolveWorkerAuthMaterial(), {
            prompt: `Use the ${PROBE_TOOL_ADVERTISED} tool now, with text set to "hook-probe". Do not search for tools and do not use Bash; the tool is already available to you. Call it, then stop.`,
            cwd: scratch.worktreePath,
            configDir: scratch.configDir,
            homeDir: scratch.homeDir,
            tmpDir: scratch.tmpDir,
            allowedTools: [PROBE_TOOL, PROBE_TOOL_ADVERTISED],
            allow: [PROBE_TOOL, PROBE_TOOL_ADVERTISED],
            disallowedTools: [...ALTERNATIVE_TOOLS],
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
          }),
        );

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

        // THE FACT THE FIX NEEDS, and it holds: a PreToolUse hook DOES see an
        // MCP tool call. It observes the underscored wire name, which is the
        // form any matcher must use.
        expect(hookCalls).toContain(PROBE_TOOL);
      } finally {
        await scratch.cleanup();
      }
    },
  );
});
