/**
 * `path-anchor.live.test` — THE OWED PROBE (03 carry-forward; README decision
 * 6; `options-assembler.ts`'s ENGINE-FACT-DRIFT note). Empirically determines
 * which substituted owned-path rule form the REAL pinned engine honors:
 *
 *   - triple-slash `Write(///abs/worktree/owned/**)` — the CURRENT form, from
 *     literal substitution of the absolute worktree path into the compiler's
 *     `//<worktree>/**` template (this is what the committed goldens emit).
 *   - double-slash `Write(//abs/worktree/owned/**)` — the alternative, one
 *     leading slash stripped.
 *
 * Probed via DIRECT query with explicit permission rules (baseline §3's
 * permission-probe shape) and NO sandbox, so only the permission-rule
 * ANCHOR MATCHING decides — for EACH form, an allow-side (a Write INSIDE the
 * owned path must succeed under the rule form) and a deny-side (a Write
 * OUTSIDE the owned path must be denied), both executed-call-guarded.
 *
 * CONDITIONAL AUTHORITY (this worker's brief): if the triple-slash form fails
 * live (inside Write denied) and the double-slash form passes,
 * `substituteWorktreePlaceholders` in `src/options-assembler.ts` is fixed to
 * strip the duplicated slash, the goldens are regenerated, W1's unit tests are
 * kept green, and the resolution is documented in wi5-live.md + a code
 * comment citing this test. The assertions below encode the CURRENT
 * expectation (triple-slash honored); a failure here is the signal to
 * exercise that authority.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  assertLiveEnabled,
  createLiveScratch,
  ensureCanary,
  guardRawRateLimit,
  resolveWorkerAuthMaterial,
  runDirectQuery,
  type LiveScratch,
} from "./live-harness.js";

interface WriteBlock {
  readonly filePath: string;
}

function writeAttempts(messages: readonly SDKMessage[]): readonly WriteBlock[] {
  const attempts: WriteBlock[] = [];
  for (const message of messages) {
    if (message.type !== "assistant") {
      continue;
    }
    const content: unknown = (message as { readonly message?: { readonly content?: unknown } })
      .message?.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      const typed = block as {
        readonly type?: unknown;
        readonly name?: unknown;
        readonly input?: unknown;
      };
      if (typed.type === "tool_use" && typed.name === "Write") {
        const filePath = (typed.input as { readonly file_path?: unknown } | null)?.file_path;
        if (typeof filePath === "string") {
          attempts.push({ filePath });
        }
      }
    }
  }
  return attempts;
}

function permissionDenialCount(messages: readonly SDKMessage[]): number {
  const result = messages.find((message) => message.type === "result") as
    { readonly permission_denials?: readonly unknown[] } | undefined;
  return result?.permission_denials?.length ?? 0;
}

interface AnchorProbeOutcome {
  readonly insideAttempted: boolean;
  readonly insideAllowed: boolean;
  readonly outsideAttempted: boolean;
  readonly outsideDenied: boolean;
}

async function probeAnchorForm(
  scratch: LiveScratch,
  ruleForm: string,
): Promise<AnchorProbeOutcome> {
  const insidePath = join(scratch.worktreePath, "owned", "inside.txt");
  const outsidePath = join(scratch.worktreePath, "outside.txt");
  const result = await runDirectQuery(resolveWorkerAuthMaterial(), {
    prompt:
      "You are a CI filesystem-permissions diagnostic step. Use the Write tool exactly twice, " +
      `attempting both regardless of any error: (1) create the file ${insidePath} with the ` +
      `content PROBE-INSIDE; (2) create the file ${outsidePath} with the content PROBE-OUTSIDE. ` +
      "A permission denial on one of them is an EXPECTED possible outcome — attempt both and report which succeeded.",
    cwd: scratch.worktreePath,
    configDir: scratch.configDir,
    homeDir: scratch.homeDir,
    tmpDir: scratch.tmpDir,
    allow: [ruleForm],
    maxTurns: 4,
  });
  guardRawRateLimit(result.messages);

  const attempts = writeAttempts(result.messages);
  const insideAttempted = attempts.some((attempt) => attempt.filePath.includes("inside.txt"));
  const outsideAttempted = attempts.some((attempt) => attempt.filePath.includes("outside.txt"));
  return {
    insideAttempted,
    // Allow-side: the inside file was actually created (the rule form matched).
    insideAllowed: existsSync(insidePath),
    outsideAttempted,
    // Deny-side: the outside file was NOT created, and at least one denial was recorded.
    outsideDenied: !existsSync(outsidePath) && permissionDenialCount(result.messages) > 0,
  };
}

beforeAll(async () => {
  assertLiveEnabled();
  await ensureCanary();
});

describe("owned-path rule anchor form honored by the real engine (03 carry-forward)", () => {
  it("the CURRENT triple-slash form allows an in-owned-path Write and denies an out-of-path Write", async () => {
    const scratch = await createLiveScratch({ seedOwnedRelPath: "owned" });
    try {
      // worktreePath already starts with '/', so `//${W}/owned/**` yields the
      // triple-slash literal `Write(///abs/worktree/owned/**)` the goldens emit.
      const tripleRule = `Write(//${scratch.worktreePath}/owned/**)`;
      const outcome = await probeAnchorForm(scratch, tripleRule);

      // Executed-call guards: both Write attempts must have actually happened.
      expect(outcome.insideAttempted, "the in-owned-path Write was never attempted").toBe(true);
      expect(outcome.outsideAttempted, "the out-of-owned-path Write was never attempted").toBe(
        true,
      );

      // The load-bearing determination: does triple-slash honor the allow?
      expect(
        outcome.insideAllowed,
        "TRIPLE-SLASH allow-side FAILED: an in-owned-path Write was denied under " +
          "Write(///abs/worktree/owned/**). If the double-slash form (below) allows it, exercise " +
          "the conditional authority: fix substituteWorktreePlaceholders + regenerate goldens.",
      ).toBe(true);
      expect(outcome.outsideDenied, "an out-of-owned-path Write was NOT denied").toBe(true);
    } finally {
      await scratch.cleanup();
    }
  });

  it("the alternative double-slash form is probed for the record (deny-side must hold regardless)", async () => {
    const scratch = await createLiveScratch({ seedOwnedRelPath: "owned" });
    try {
      // One leading slash stripped: `/${W}/owned/**` yields `Write(//abs/worktree/owned/**)`.
      const doubleRule = `Write(/${scratch.worktreePath}/owned/**)`;
      const outcome = await probeAnchorForm(scratch, doubleRule);

      expect(outcome.insideAttempted, "the in-owned-path Write was never attempted").toBe(true);
      expect(outcome.outsideAttempted, "the out-of-owned-path Write was never attempted").toBe(
        true,
      );
      // Deny-side must hold for either form (a non-matching allow denies the outside write).
      expect(outcome.outsideDenied, "an out-of-owned-path Write was NOT denied").toBe(true);
      // insideAllowed for the double-slash form is recorded (not asserted) — it
      // is the tie-breaker the conditional-authority decision reads if the
      // triple-slash allow-side test above fails. See wi5-live.md.
    } finally {
      await scratch.cleanup();
    }
  });
});
