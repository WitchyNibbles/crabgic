/**
 * `adjudication-bridge.live.test` — the AUTHORED probe Finding 2 owes. It
 * converts an UNPROBED engine fact into a live-gated assertion: whether the
 * SDK invokes the `canUseTool` bridge at all under
 * `permissionMode: "dontAsk"` (docs/engine-baseline.md §3 probed enforcement
 * via the static allow/deny lists + `result.permission_denials`, with NO
 * `canUseTool` installed — so this is genuinely unverified, per the
 * engine-fact-drift ground rule).
 *
 * It installs the REAL `ClaudeEngineAdapter` (default SDK `query`), a REAL
 * `createAdjudicationBus`-backed policy (05's journal-teed bus wrapping this
 * package's `createEnvelopeAdjudicationPolicy`), and the harness's temp-dir
 * `JournalStore`, then drives ONE genuinely-allowed, cheap tool —
 * `Bash(git status:*)`, which the standard-implementation envelope allows —
 * to completion, and asserts:
 *
 *   (a) the worker does NOT audit-abort (Finding 2: a pre-approved tool must
 *       be treated as in-scope of the static `dontAsk` allow-list, not as a
 *       spurious adjudicated-vs-executed mismatch — and since the PreToolUse
 *       bridge now RECORDS the allowed Bash decision, this also smokes the
 *       PostToolUse audit path with real records in scope for the first
 *       time), and
 *   (b) an `adjudication_decision` journal entry EXISTS for the driven call,
 *       and every one is an allow. Originally this only recorded whether
 *       `canUseTool` fired; the answer is measured now (it never does for a
 *       rule-matched call, baseline §4.7) and the record instead comes from
 *       the PreToolUse tool-adjudication hook, which this asserts.
 *
 * Like every `*.live.test.ts` file it fails RED (never skips) without
 * `CRABGIC_LIVE=1` — `assertLiveEnabled()` in `beforeAll` throws so the
 * engine-live CI job goes red rather than vacuously green.
 */
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { CANONICAL_ENVELOPE_CASES, compileEnvelope } from "@crabgic/engine-core";
import type { AdjudicationCallback, EngineEvent } from "@crabgic/engine-core";
import { createAdjudicationBus } from "@crabgic/supervisor";
import { buildTaskPacket } from "@crabgic/testkit";
import { createEnvelopeAdjudicationPolicy } from "../adjudication-policy.js";
import { substituteWorktreePlaceholders } from "../options-assembler.js";
import { AdjudicationAuditViolationError } from "../adapter.js";
import {
  assertLiveEnabled,
  assertToolUseEmitted,
  collectEngineEvents,
  createLiveAdapterContext,
  ensureCanary,
  guardEngineEventsRateLimit,
} from "./live-harness.js";

const STANDARD_CASE = CANONICAL_ENVELOPE_CASES.find(
  (envelopeCase) => envelopeCase.name === "standard-implementation",
);
if (STANDARD_CASE === undefined) {
  throw new Error("standard-implementation canonical envelope case not found");
}

/** Collects the `payload.decision` of every `adjudication_decision` journal entry (the empirical canUseTool-fired signal). */
async function collectAdjudicationDecisions(
  journal: Awaited<ReturnType<typeof createLiveAdapterContext>>["journal"],
): Promise<readonly string[]> {
  const decisions: string[] = [];
  for await (const entry of journal.queryEntries({ type: "adjudication_decision" })) {
    const decision = (entry as { readonly payload?: { readonly decision?: unknown } }).payload
      ?.decision;
    if (typeof decision === "string") {
      decisions.push(decision);
    }
  }
  return decisions;
}

beforeAll(async () => {
  assertLiveEnabled();
  await ensureCanary();
});

describe("adjudication bridge under permissionMode:'dontAsk' (Finding 2 — canUseTool-fired is an unprobed engine fact)", () => {
  it("drives an allowed Bash(git status) to completion: the worker does NOT audit-abort, and whether canUseTool fired is recorded empirically", async () => {
    const ctx = await createLiveAdapterContext();
    try {
      // A real git repo in the worktree so `git status` completes cleanly.
      execFileSync("git", ["init", "--quiet"], { cwd: ctx.scratch.worktreePath });

      const profile = compileEnvelope(STANDARD_CASE.envelope);
      // The envelope policy's binding precondition is ALREADY-substituted
      // permissions (adjudication-policy.ts top-of-file). Substitute with the
      // same worktree/worker-tmp the adapter itself uses so the policy and the
      // adapter agree.
      const substituted = substituteWorktreePlaceholders(
        profile,
        ctx.scratch.worktreePath,
        ctx.scratch.tmpDir,
      );
      const policy = createEnvelopeAdjudicationPolicy({ permissions: substituted.permissions });
      const adjudicate: AdjudicationCallback = createAdjudicationBus({
        journal: ctx.journal,
        policy,
      });

      const packet = buildTaskPacket({
        objective:
          "CI permissions diagnostic. Use the Bash tool exactly once to run precisely: git status. " +
          "Then reply with exactly: done.",
        ownedPaths: [],
        resourceLimits: { maxTurns: 4 },
        resultSchema: { type: "object" },
      });

      const handle = ctx.adapter.spawn(packet, profile, adjudicate);

      let events: EngineEvent[] = [];
      let auditAborted = false;
      try {
        events = await collectEngineEvents(handle.events);
      } catch (err) {
        if (err instanceof AdjudicationAuditViolationError) {
          auditAborted = true;
        } else {
          throw err;
        }
      }
      guardEngineEventsRateLimit(events);

      // (a) The worker must NOT audit-abort on a genuinely pre-approved tool.
      expect(
        auditAborted,
        "the worker audit-aborted on a genuinely-allowed pre-approved tool (Finding 2 regression)",
      ).toBe(false);

      // Executed-call guard: the git-status Bash call actually ran.
      assertToolUseEmitted(
        events,
        (event) =>
          event.toolName === "Bash" &&
          typeof event.toolInput.command === "string" &&
          (event.toolInput.command as string).includes("git status"),
        "Bash(git status) — the driven, genuinely-allowed tool",
      );

      // (b) THE RECORD MUST EXIST. The original version of this probe only
      // RECORDED whether canUseTool fired, and the answer (measured 2026-07-30,
      // baseline §4.7) is that it never does for a rule-matched Bash call — the
      // matched `Bash(git status:*)` allow entry auto-approves before the
      // callback. Since then the PreToolUse tool-adjudication hook
      // (`tool-adjudication-hook.ts`) covers Bash, so a real adapter run MUST
      // journal at least one adjudication decision for the driven call, and
      // every decision for it must be an allow. A zero here is the old hole
      // reopening: a mutation-capable call executing with no adjudication
      // record.
      const decisions = await collectAdjudicationDecisions(ctx.journal);
      expect(
        decisions.length,
        "no adjudication_decision was journaled for the driven Bash call — the " +
          "PreToolUse bridge did not fire, and the mutation-capable tools are " +
          "executing unrecorded again (baseline §4.7 regression)",
      ).toBeGreaterThan(0);
      expect(
        decisions.every((decision) => decision === "allow"),
        "every recorded adjudication decision for the allowed git-status call must be an allow",
      ).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  });
});
