/**
 * Attempt-repair policy — roadmap/13-scheduler-packets-context.md §In
 * scope, "Attempt policy": "one initial + two evidence-driven repairs;
 * repeating an unsuccessful action requires new diagnostic evidence
 * (journal-checked) — either the worker's own reported failure
 * (WorkerResult) or a gate verdict surfaced by 14... a third attempt
 * WITHOUT new diagnostic evidence is refused with a TYPED error." §Test
 * plan, Conformance: "a 06-reported schema-violation failure is accepted
 * as valid repair-triggering evidence exactly once per attempt (no
 * double-counting toward the two-repair cap)."
 *
 * JOURNAL-CHECKED (restart-safe): the attempt COUNT this policy enforces
 * is derived by counting `work_unit_transition` entries with
 * `payload.status === "dispatched"` for the work unit — never an
 * in-memory counter this package invents and could lose across a
 * supervisor restart. "No double-counting toward the two-repair cap" is
 * satisfied by construction: the cap counter is the recorded-dispatch
 * count, entirely independent of `evidenceKind` — citing the SAME
 * schema-violation as evidence twice (e.g. a caller re-checking before
 * actually redispatching) never itself advances the counter; only a real
 * `dispatched` journal entry does.
 *
 * MAJOR-1 fix (adversarial-validation round): `countPriorDispatches` now
 * EXCLUDES a `dispatched` transition whose `previousStatus` is
 * `parked:rate_limit` — a rate-limit park→resume cycle is an EXTERNAL
 * THROTTLE, not a failed action (roadmap/13 §In scope, "Limit parking":
 * "same recovery machinery, different trigger" — parking retains the
 * session and is triggered by an engine-side rate limit, never by the
 * work unit's own conduct). Before this fix, every park-resume silently
 * consumed one of the 3 total repair slots, so a rate-limited unit could
 * receive as few as 1 REAL repair instead of 2. `previousStatus` is
 * already auto-populated by `@crabgic/journal`'s own `recordAttempt` from each
 * work unit's latest prior attempt at call time — no new journal write
 * shape is needed to detect this.
 *
 * Also new: an optional `evidenceDetail` fingerprint on `assertRepairAllowed`
 * — when supplied, a repair citing evidence IDENTICAL (same `evidenceKind`
 * AND identical `evidenceDetail` text) to the evidence that justified the
 * IMMEDIATELY-PRIOR repair is refused (`reason: "evidenceNotDistinct"`):
 * merely re-citing the same coarse `evidenceKind` twice was already
 * insufficient to prove genuine progress, since the cap is dispatch-count-
 * based, not evidence-based — this closes that residual gap for callers
 * that have the actual diagnostic text available. Omitting `evidenceDetail`
 * (the pre-existing call shape) skips this check entirely — fully
 * backward-compatible. Recorded via the SAME documented `adjudication_
 * decision`-reuse precedent `../parking.ts` already establishes (see that
 * module's own file-level doc comment) — no new `JournalEntryType` member,
 * guarded `JSON.parse` (never trusts file content, mirroring `../parking.ts`'s
 * own MINOR-4 fix).
 */

import { z } from "zod";
import { getLatestAttempt, type JournalStore } from "@crabgic/journal";
import { normalizePlannedPath } from "@crabgic/git-engine";
import { RepairEvidenceRequiredError } from "./errors.js";

/**
 * What kind of "new diagnostic evidence" justifies a repair attempt.
 * `"none"` means the caller has nothing new to justify repeating an
 * unsuccessful action — always refused past the initial attempt.
 */
export type AttemptEvidenceKind =
  "workerResultFailure" | "schemaViolation" | "crash" | "gateVerdict" | "none";

/** One initial dispatch + two evidence-driven repairs = 3 total dispatches, never more. */
export const MAX_TOTAL_DISPATCHES = 3;

/**
 * Counts how many GENUINE repair-consuming `dispatched` transitions have
 * been journaled for `workUnitId` so far — the journal-derived, restart-
 * safe attempt counter this policy enforces against. A `dispatched`
 * transition whose `previousStatus` is `parked:rate_limit` (a park-resume,
 * not a repair — see file-level doc comment) is EXCLUDED.
 */
export async function countPriorDispatches(
  store: JournalStore,
  workUnitId: string,
  runId?: string,
): Promise<number> {
  // Scoped to `runId` when given. Work-unit ids are stable across runs of
  // the same change set, so a workUnitId-only count made a retry as a
  // genuinely new run inherit the prior run's exhausted repair budget. The
  // budget stops a REPAIR LOOP within a run; a fresh run is a new,
  // containment-gated, journaled attempt sequence and gets its own budget.
  // Absent `runId`, the count is unchanged (across all runs) — the
  // evidence/traceability default direct callers already want.
  let count = 0;
  for await (const entry of store.queryEntries({
    type: "work_unit_transition",
    workUnitId,
    ...(runId !== undefined ? { runId } : {}),
  })) {
    if (
      entry.type === "work_unit_transition" &&
      entry.payload.status === "dispatched" &&
      entry.payload.previousStatus !== "parked:rate_limit"
    ) {
      count += 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Evidence-distinctness fingerprint (see file-level doc comment).
// ---------------------------------------------------------------------------

const REPAIR_EVIDENCE_DECISION = "repair_evidence_record";

const EVIDENCE_KINDS = [
  "workerResultFailure",
  "schemaViolation",
  "crash",
  "gateVerdict",
  "none",
] as const;

const RepairEvidenceRecordSchema = z
  .object({
    evidenceKind: z.enum(EVIDENCE_KINDS),
    evidenceDetail: z.string(),
  })
  .strict();

interface RepairEvidenceRecord {
  readonly evidenceKind: AttemptEvidenceKind;
  readonly evidenceDetail: string;
}

/** Guarded parse — never throws for malformed/foreign content (mirrors `../parking.ts`'s MINOR-4 fix). */
function parseRepairEvidenceRecord(rationale: string): RepairEvidenceRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rationale);
  } catch {
    return undefined;
  }
  const result = RepairEvidenceRecordSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

async function getLatestRepairEvidence(
  store: JournalStore,
  workUnitId: string,
): Promise<RepairEvidenceRecord | undefined> {
  let latestSeq = -1;
  let latest: RepairEvidenceRecord | undefined;
  for await (const entry of store.queryEntries({ type: "adjudication_decision", workUnitId })) {
    if (entry.type !== "adjudication_decision") continue;
    if (entry.payload.decision !== REPAIR_EVIDENCE_DECISION) continue;
    if (entry.seq <= latestSeq) continue;
    const parsed = parseRepairEvidenceRecord(entry.payload.rationale);
    if (parsed === undefined) continue;
    latestSeq = entry.seq;
    latest = parsed;
  }
  return latest;
}

async function recordRepairEvidence(
  store: JournalStore,
  workUnitId: string,
  evidenceKind: AttemptEvidenceKind,
  evidenceDetail: string,
): Promise<void> {
  await store.appendEntry({
    type: "adjudication_decision",
    workUnitId,
    payload: {
      decision: REPAIR_EVIDENCE_DECISION,
      rationale: JSON.stringify({ evidenceKind, evidenceDetail } satisfies RepairEvidenceRecord),
      subjectId: workUnitId,
    },
  });
}

// ---------------------------------------------------------------------------
// Write-set monotonicity — owner ruling R4's FOURTH admissibility bound.
// ---------------------------------------------------------------------------

/**
 * `docs/design/owner-pipeline-conformance.md` §4.3, bound 4: "a repair may not
 * enlarge the `PlannedWriteSet`, on pain of re-entering the plan stage in the
 * open."
 *
 * ⚠️ WHY IT LIVES HERE. `../review/admissibility.ts` implements bounds 1-3 and
 * says in its own header that this one "is enforced where a repair's write set
 * is decided, not here", because a pure function over one round's findings has
 * no round-over-round history to compare against. This module IS that place: it
 * is the choke point every repair already passes, it already reads the journal,
 * and it already carries a durable per-attempt record for evidence
 * distinctness. Until 2026-08-18 the bound was documented as living elsewhere
 * and lived nowhere — defect
 * `docs/evidence/criteria-closeout/defects/25-monotonicity-bound-is-enforced-nowhere.md`.
 *
 * WHAT IT BUYS. `admissibility.ts` concedes that a repair "writes new code
 * inside the write set, and new code carries new obligations", so termination
 * "rests on the repair rate exceeding the new-obligation rate". This bound is
 * what keeps that qualifier bounded rather than open-ended: the space each
 * repair draws obligations from cannot grow.
 */
const WRITE_SET_DECISION = "repair_write_set_record";

const WriteSetRecordSchema = z.object({ ownedPaths: z.array(z.string()) }).strict();

/** Guarded parse — same posture as `parseRepairEvidenceRecord` above. */
function parseWriteSetRecord(rationale: string): readonly string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rationale);
  } catch {
    return undefined;
  }
  const result = WriteSetRecordSchema.safeParse(parsed);
  return result.success ? result.data.ownedPaths : undefined;
}

async function getLatestWriteSet(
  store: JournalStore,
  workUnitId: string,
): Promise<readonly string[] | undefined> {
  let latestSeq = -1;
  let latest: readonly string[] | undefined;
  for await (const entry of store.queryEntries({ type: "adjudication_decision", workUnitId })) {
    if (entry.type !== "adjudication_decision") continue;
    if (entry.payload.decision !== WRITE_SET_DECISION) continue;
    if (entry.seq <= latestSeq) continue;
    const parsed = parseWriteSetRecord(entry.payload.rationale);
    if (parsed === undefined) continue;
    latestSeq = entry.seq;
    latest = parsed;
  }
  return latest;
}

async function recordWriteSet(
  store: JournalStore,
  workUnitId: string,
  ownedPaths: readonly string[],
): Promise<void> {
  await store.appendEntry({
    type: "adjudication_decision",
    workUnitId,
    payload: {
      decision: WRITE_SET_DECISION,
      rationale: JSON.stringify({ ownedPaths: [...ownedPaths] }),
      subjectId: workUnitId,
    },
  });
}

/**
 * Is `candidate` the same path as `owned`, or a file beneath it?
 *
 * ⚠️ SEGMENT-WISE, never `startsWith`. A raw prefix test admits
 * `packages/cli/src-extra/x.ts` as a child of `packages/cli/src`, and a bound
 * any path can be spelled past is not a bound — the same unbounded-search-space
 * failure `admissibility.ts` exists to close, arriving through the back door.
 *
 * Normalization is `@crabgic/git-engine`'s `normalizePlannedPath`, the SAME
 * function the overlap analyzer and the novelty key use. Roadmap/25 requires one
 * implementation rather than two that agree, and this is that requirement
 * applied to a third caller rather than a fourth copy.
 */
function isCoveredBy(candidate: string, owned: string): boolean {
  const c = normalizePlannedPath(candidate);
  const o = normalizePlannedPath(owned);
  if (c === o) return true;
  return c.startsWith(o + "/");
}

/** The candidate paths no prior-owned path covers. Empty means the repair did not widen. */
function pathsNotCoveredBy(
  candidates: readonly string[],
  priorOwned: readonly string[],
): readonly string[] {
  return candidates.filter(
    (candidate) => !priorOwned.some((owned) => isCoveredBy(candidate, owned)),
  );
}

/**
 * Throws `RepairEvidenceRequiredError` if dispatching `workUnitId` again
 * would violate the attempt policy:
 *  - `reason: "attemptsExhausted"` if `MAX_TOTAL_DISPATCHES` prior
 *    (genuine, non-park-resume) dispatches are already recorded,
 *    regardless of `evidenceKind`.
 *  - `reason: "noNewEvidence"` if this would be a REPAIR (priorDispatches
 *    > 0) and `evidenceKind === "none"`.
 *  - `reason: "evidenceNotDistinct"` if `evidenceDetail` is supplied and is
 *    IDENTICAL (same `evidenceKind` and text) to the evidence recorded for
 *    the immediately-prior repair.
 * The very first dispatch (`priorDispatches === 0`) always proceeds — no
 * evidence is required to dispatch a `WorkUnit` for the first time, and no
 * evidence-distinctness check ever runs for it (nothing prior to compare
 * against).
 *
 * When `evidenceDetail` is supplied and this call does NOT throw, the
 * `(evidenceKind, evidenceDetail)` pair is durably recorded (journal-
 * derived, restart-safe) so the NEXT repair's distinctness check has
 * something to compare against — this keeps the check-and-record atomic
 * from this function's one call site, mirroring `../parking.ts`'s
 * `parkWorkUnit` (check-shaped work, single call, single side effect).
 */
export async function assertRepairAllowed(
  store: JournalStore,
  workUnitId: string,
  evidenceKind: AttemptEvidenceKind,
  evidenceDetail?: string,
  runId?: string,
  /**
   * This attempt's planned write set. OPTIONAL, exactly as `evidenceDetail` is:
   * `resumeAttempt`'s crash-repair path holds a session rather than a packet,
   * so it has no write set to check — and it rebuilds none, so there is nothing
   * it could widen. Omitting it skips the bound entirely, which keeps every
   * existing caller working and grants none of them a guarantee it did not ask
   * for.
   */
  ownedPaths?: readonly string[],
): Promise<void> {
  // Run-scoped budget — see `countPriorDispatches`. The evidence-distinctness
  // check below is intentionally NOT run-scoped: distinct diagnostic evidence
  // is a property of the WORK, and re-attempting an identical failure adds no
  // information regardless of which run does it.
  const priorDispatches = await countPriorDispatches(store, workUnitId, runId);

  if (priorDispatches >= MAX_TOTAL_DISPATCHES) {
    throw new RepairEvidenceRequiredError(workUnitId, "attemptsExhausted", priorDispatches);
  }
  // The initial attempt requires no evidence, and no evidence-distinctness
  // check can run for it — but it still has a write set, and recording that set
  // is what gives the FIRST repair something to be bounded against. Before
  // 2026-08-18 this returned early and the bound had no baseline to compare to.
  const isRepair = priorDispatches > 0;

  if (isRepair && evidenceKind === "none") {
    throw new RepairEvidenceRequiredError(workUnitId, "noNewEvidence", priorDispatches);
  }

  if (isRepair && evidenceDetail !== undefined) {
    const lastEvidence = await getLatestRepairEvidence(store, workUnitId);
    const identicalToLast =
      lastEvidence !== undefined &&
      lastEvidence.evidenceKind === evidenceKind &&
      lastEvidence.evidenceDetail === evidenceDetail;
    if (identicalToLast) {
      throw new RepairEvidenceRequiredError(workUnitId, "evidenceNotDistinct", priorDispatches);
    }
    await recordRepairEvidence(store, workUnitId, evidenceKind, evidenceDetail);
  }

  if (ownedPaths !== undefined) {
    const priorOwned = await getLatestWriteSet(store, workUnitId);
    if (priorOwned !== undefined) {
      const widening = pathsNotCoveredBy(ownedPaths, priorOwned);
      if (widening.length > 0) {
        throw new RepairEvidenceRequiredError(
          workUnitId,
          "writeSetWidened",
          priorDispatches,
          widening,
        );
      }
    }
    await recordWriteSet(store, workUnitId, ownedPaths);
  }
}

/**
 * Convenience read-back: `true` iff this work unit's latest recorded
 * attempt is itself in a state that would ever need this policy consulted
 * again (i.e. not already succeeded/cancelled). Exposed for callers (e.g.
 * `../executor.ts`) that want a cheap short-circuit before computing a
 * full repair packet.
 */
export async function needsRepairPolicyCheck(
  store: JournalStore,
  workUnitId: string,
): Promise<boolean> {
  const latest = await getLatestAttempt(store, workUnitId);
  return latest !== undefined && latest.status !== "succeeded" && latest.status !== "cancelled";
}
