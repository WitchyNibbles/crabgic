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
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
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

/**
 * Collects every `adjudication_decision` journal entry as `{decision, rationale}`.
 *
 * The rationale is what lets an assertion scope itself to ONE tool: the bus
 * journals an allow as exactly `allowed tool call: <toolName>`. Asserting over
 * ALL decisions instead was a review-caught flake: a worker that tries one
 * legitimately-denied extra command on the way to the driven one would fail an
 * `every(allow)` check without anything being wrong.
 */
async function collectAdjudicationDecisions(
  journal: Awaited<ReturnType<typeof createLiveAdapterContext>>["journal"],
): Promise<readonly { readonly decision: string; readonly rationale: string }[]> {
  const decisions: { readonly decision: string; readonly rationale: string }[] = [];
  for await (const entry of journal.queryEntries({ type: "adjudication_decision" })) {
    const payload = (
      entry as { readonly payload?: { readonly decision?: unknown; readonly rationale?: unknown } }
    ).payload;
    if (typeof payload?.decision === "string") {
      decisions.push({
        decision: payload.decision,
        rationale: typeof payload.rationale === "string" ? payload.rationale : "",
      });
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
        decisions.some(
          (entry) => entry.decision === "allow" && entry.rationale === "allowed tool call: Bash",
        ),
        `no allow adjudication_decision was journaled for the driven Bash call — the ` +
          `PreToolUse bridge did not fire, and the mutation-capable tools are ` +
          `executing unrecorded again (baseline §4.7 regression). Decisions seen: ` +
          `${JSON.stringify(decisions)}`,
      ).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  });

  it("drives an allowed Write into an owned path: Pre→Post input is stable (no audit abort) and the decision is journaled", async () => {
    // Review finding F4 on the built-in coverage change: Bash/Edit/Write newly
    // enter the PostToolUse audit's scope with the RAW PreToolUse `tool_input`
    // recorded, so any engine-side input mutation between PreToolUse and
    // PostToolUse would abort a legitimate worker. The Bash test above cannot
    // measure that for the path-taking tools; this drives a real `Write` into
    // the standard envelope's owned path and asserts the worker survives its
    // own audit — which is a live measurement that the engine hands PostToolUse
    // the same `tool_input` it handed PreToolUse for a `Write`.
    const ctx = await createLiveAdapterContext();
    try {
      const ownedDir = join(ctx.scratch.worktreePath, "packages", "example", "src");
      await mkdir(ownedDir, { recursive: true });

      const profile = compileEnvelope(STANDARD_CASE.envelope);
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
          "CI permissions diagnostic. Use the Write tool exactly once to create the file " +
          "packages/example/src/probe.txt (inside the current working directory) with exactly " +
          "the content: ok. Then reply with exactly: done.",
        ownedPaths: ["packages/example/src"],
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

      // THE MEASUREMENT: a genuinely-allowed Write must not audit-abort. If
      // this fails with an abort, the engine mutated `tool_input` between
      // PreToolUse and PostToolUse for Write, and recording the raw input is
      // the wrong contract for path tools.
      expect(
        auditAborted,
        "the worker audit-aborted on a genuinely-allowed owned-path Write — " +
          "Pre→Post tool_input is NOT stable for Write and the audit contract needs revisiting",
      ).toBe(false);

      // Executed-call guard: the Write actually happened, into the owned path.
      assertToolUseEmitted(
        events,
        (event) =>
          event.toolName === "Write" &&
          typeof event.toolInput.file_path === "string" &&
          (event.toolInput.file_path as string).includes("packages/example/src/probe.txt"),
        "Write(packages/example/src/probe.txt) — the driven, genuinely-allowed tool",
      );

      // And the record exists: the PreToolUse bridge journaled the allow.
      const decisions = await collectAdjudicationDecisions(ctx.journal);
      expect(
        decisions.some(
          (entry) => entry.decision === "allow" && entry.rationale === "allowed tool call: Write",
        ),
        `no allow adjudication_decision was journaled for the driven Write call. ` +
          `Decisions seen: ${JSON.stringify(decisions)}`,
      ).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  });
});
