/**
 * `builtin-allow-rule-shadowing.live.test` — the probe `docs/security-posture.md`
 * ("STILL OPEN, and larger") owes: whether a RULE-SHAPED allow entry —
 * `Bash(git status:*)`, the exact shape `emitPermissionProfile` compiles for the
 * mutation-capable built-ins — shadows `canUseTool` the way a BARE name does.
 *
 * WHY THIS IS A SEPARATE FACT FROM §4.5. The 2026-07-30 finding
 * (`docs/engine-baseline.md` §4.5, probed by the sibling
 * `mcp-adjudication-shadowing.live.test.ts`) established shadowing for a tool
 * NAMED OUTRIGHT in `allowedTools` (`mcp__<gateway>__*`). The compiled profile
 * grants `Bash`/`Edit`/`Write` differently — by RULE (`Bash(<prefix>:*)`,
 * `Edit(//<worktree>/…/**)`), where the entry gates on the call's ARGUMENTS,
 * not just its name. Whether a matched rule also short-circuits before
 * `canUseTool` was never probed in either direction; the SDK's own shadowing
 * warning names only bare entries and adds, unquantified, that "allow rules
 * from settings files can also shadow the callback but are not visible here."
 * Adversarial review (2026-07-30) found every production `Bash`/`Edit`/`Write`
 * call rides exactly this shape, so the answer decides whether the
 * mutation-capable tools execute with any adjudication record at all.
 *
 * So this probe asks both halves, exactly as the MCP sibling did:
 *
 *   (a) is `canUseTool` invoked for a `Bash` call MATCHED by a
 *       `Bash(git status:*)` allow rule under `permissionMode: "dontAsk"`?
 *   (b) does a `PreToolUse` hook fire for that same matched call — the fact
 *       the fix (extending the deny-only adjudication hook beyond the gateway
 *       prefix) rests on?
 *
 * WHAT THIS PROBE ESTABLISHED (live, engine 2.1.218, 2026-07-30):
 *
 * - **(a) `canUseTool` is shadowed by a MATCHED rule-shaped allow entry —
 *   CONFIRMED.** The callback was never invoked for the executed, genuinely
 *   rule-matched `git status` call. The executed-call guard held (the command
 *   ran and returned real `git status` output), so this is "auto-approved
 *   before the callback", not "denied before the callback".
 * - **(b) a `PreToolUse` hook DOES fire for that same matched `Bash` call —
 *   CONFIRMED.** Same remedy as §4.5: hooks run before permission evaluation,
 *   so the deny-only adjudication bridge can cover the built-ins too.
 *
 * The INCONCLUSIVE guard matters here for the same reason it did in the MCP
 * probe: "the gate did not fire" and "nothing was gated" look identical in a
 * bare assertion and mean opposite things. Both tests therefore first assert
 * the model genuinely executed `git status` (real `tool_use` block AND real
 * command output), and only then say anything about which gate fired.
 *
 * Like every `*.live.test.ts` here it fails RED (never skips) without
 * `CRABGIC_LIVE=1`.
 */
import { runFixtureGit } from "@crabgic/testkit";
import { beforeAll, describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  assertLiveEnabled,
  bashCommandsAttempted,
  createLiveScratch,
  resolveWorkerAuthMaterial,
  runDirectQuery,
  toolResultText,
} from "./live-harness.js";

/**
 * The rule under test, byte-identical to what `emitPermissionProfile` compiles
 * for the `git status` grant (`permission-profile.ts`'s closed Bash allowlist).
 * It travels BOTH channels production sends it down: `settings.permissions.allow`
 * (the `allow` field) and SDK `allowedTools` (`worker-settings.ts` /
 * `options-assembler.ts` copy the same array into both).
 */
const RULE_UNDER_TEST = "Bash(git status:*)";

const PROMPT =
  "CI permissions diagnostic. Use the Bash tool exactly once to run precisely: git status. " +
  "Do not run any other command. Then reply with exactly: done.";

/** A fresh `git init` repo so `git status` completes with unmistakable output. */
function initGitRepo(worktreePath: string): void {
  runFixtureGit(worktreePath, ["init", "--quiet"]);
}

/**
 * Whether the driven call genuinely EXECUTED: a real `Bash` `tool_use` block
 * whose command contains `expectedCommand`, AND real `git status` output in a
 * `tool_result`. The second half is what distinguishes "auto-approved before
 * the callback" (the shadowing under probe) from "denied before the callback"
 * (which would also leave `canUseTool` uninvoked and would prove nothing).
 */
function commandExecuted(messages: readonly SDKMessage[], expectedCommand: string): boolean {
  const attempted = bashCommandsAttempted(messages).some((command) =>
    command.includes(expectedCommand),
  );
  const resultText = toolResultText(messages);
  return attempted && (resultText.includes("No commits yet") || resultText.includes("On branch"));
}

async function untilCommandExecuted(
  tries: number,
  expectedCommand: string,
  attempt: () => Promise<{ readonly messages: readonly SDKMessage[] }>,
): Promise<{ readonly messages: readonly SDKMessage[] }> {
  let last: { readonly messages: readonly SDKMessage[] } = { messages: [] };
  for (let index = 1; index <= tries; index += 1) {
    last = await attempt();
    if (commandExecuted(last.messages, expectedCommand)) return last;
  }
  return last;
}

beforeAll(() => {
  assertLiveEnabled();
});

describe("built-in allow-RULE shadowing (engine fact, live)", () => {
  it(
    "does NOT invoke canUseTool for a Bash call matched by a Bash(git status:*) allow rule",
    { timeout: 240_000 },
    async () => {
      const scratch = await createLiveScratch();
      try {
        initGitRepo(scratch.worktreePath);
        const canUseToolCalls: string[] = [];
        const result = await untilCommandExecuted(3, "git status", () =>
          runDirectQuery(resolveWorkerAuthMaterial(), {
            prompt: PROMPT,
            cwd: scratch.worktreePath,
            configDir: scratch.configDir,
            homeDir: scratch.homeDir,
            tmpDir: scratch.tmpDir,
            // Granted exactly the way the compiled profile grants it: the same
            // rule string in BOTH settings.permissions.allow and allowedTools.
            allow: [RULE_UNDER_TEST],
            allowedTools: [RULE_UNDER_TEST],
            canUseTool: (toolName) => {
              canUseToolCalls.push(toolName);
              return Promise.resolve({ behavior: "allow" as const, updatedInput: {} });
            },
            maxTurns: 4,
          }),
        );

        // INCONCLUSIVE, NOT FAILED, when the call never genuinely executed —
        // including the case where it was DENIED (no real git-status output):
        // a denied call also never reaches canUseTool, and measures nothing
        // about shadowing.
        expect(
          commandExecuted(result.messages, "git status"),
          `INCONCLUSIVE: the model did not EXECUTE "git status" on this run (attempted ` +
            `commands: ${JSON.stringify(bashCommandsAttempted(result.messages))}), so this ` +
            `says nothing about which gate fires. Steer the prompt or raise maxTurns; ` +
            `do NOT relax the assertion below.`,
        ).toBe(true);

        // THE FACT UNDER PROBE: the callback is never consulted for a call a
        // rule-shaped allow entry matched.
        expect(canUseToolCalls).not.toContain("Bash");
      } finally {
        await scratch.cleanup();
      }
    },
  );

  it(
    "DOES invoke a PreToolUse hook for that same rule-matched Bash call — the fact the fix rests on",
    { timeout: 240_000 },
    async () => {
      const scratch = await createLiveScratch();
      try {
        initGitRepo(scratch.worktreePath);
        const hookCalls: string[] = [];
        const result = await untilCommandExecuted(3, "git status", () =>
          runDirectQuery(resolveWorkerAuthMaterial(), {
            prompt: PROMPT,
            cwd: scratch.worktreePath,
            configDir: scratch.configDir,
            homeDir: scratch.homeDir,
            tmpDir: scratch.tmpDir,
            allow: [RULE_UNDER_TEST],
            allowedTools: [RULE_UNDER_TEST],
            hooks: {
              PreToolUse: [
                {
                  // Every tool — the probe measures whether a rule-matched
                  // built-in reaches hooks at all, not whether one matcher
                  // syntax works.
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
            maxTurns: 4,
          }),
        );

        expect(
          commandExecuted(result.messages, "git status"),
          `INCONCLUSIVE: the model did not EXECUTE "git status" on this run. Hook calls ` +
            `observed: ${JSON.stringify(hookCalls)}. An empty list here means nothing was ` +
            `gated, NOT that hooks miss rule-matched built-ins.`,
        ).toBe(true);

        // THE FACT THE FIX NEEDS: a PreToolUse hook sees the rule-matched
        // Bash call, before the permission evaluation that shadows canUseTool.
        expect(hookCalls).toContain("Bash");
      } finally {
        await scratch.cleanup();
      }
    },
  );

  it(
    "the ENGINE allows a metacharacter-bearing command matched by a prefix rule — the measured divergence that keeps the bridge opinion-less for built-ins",
    { timeout: 240_000 },
    async () => {
      // Adversarial review (F1) caught that wiring the envelope policy into a
      // deny-capable PreToolUse hook would have activated the policy's
      // documented fail-closed-on-unproven metacharacter denial on every
      // production Bash call. Whether that diverged from the engine was
      // UNPROVEN in either direction (baseline §3 probed only compound
      // operators and wrappers). This measures it: `git status 2>&1` carries
      // `>` and `&` — both in the policy's unproven-metacharacter deny set —
      // and the engine's own `Bash(git status:*)` rule ALLOWS it (executed,
      // zero permission denials). So the policy is measurably STRICTER than
      // the engine inside a matched prefix, and a hook that turned the
      // policy's verdict into a deny would refuse calls the engine grants —
      // which is why the bridge records built-in verdicts without acting on
      // them (`tool-adjudication-hook.ts`, record-not-refuse).
      const scratch = await createLiveScratch();
      try {
        initGitRepo(scratch.worktreePath);
        const result = await untilCommandExecuted(3, "git status 2>&1", () =>
          runDirectQuery(resolveWorkerAuthMaterial(), {
            prompt:
              "CI permissions diagnostic. Use the Bash tool exactly once to run precisely this " +
              "command, byte for byte, without simplifying it: git status 2>&1\n" +
              "Then reply with exactly: done.",
            cwd: scratch.worktreePath,
            configDir: scratch.configDir,
            homeDir: scratch.homeDir,
            tmpDir: scratch.tmpDir,
            allow: [RULE_UNDER_TEST],
            allowedTools: [RULE_UNDER_TEST],
            maxTurns: 4,
          }),
        );

        // The measured fact IS the execution: the redirect-bearing command ran
        // to completion under the prefix rule. A permission denial here would
        // leave no real git-status output, so the executed guard is the
        // assertion.
        expect(
          commandExecuted(result.messages, "git status 2>&1"),
          `INCONCLUSIVE OR DENIED: "git status 2>&1" did not execute (attempted: ` +
            `${JSON.stringify(bashCommandsAttempted(result.messages))}). If the model attempted ` +
            `it and it did not run, the engine may now DENY metacharacters inside a matched ` +
            `prefix — re-measure before trusting §4.8, and revisit the bridge's ` +
            `record-not-refuse posture for built-ins.`,
        ).toBe(true);
      } finally {
        await scratch.cleanup();
      }
    },
  );
});
