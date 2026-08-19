import { randomUUID } from "node:crypto";
import {
  CURRENT_SCHEMA_VERSION,
  EvidenceRecordSchema,
  type EvidenceRecord,
} from "@crabgic/contracts";
import type { JournalStore } from "@crabgic/journal";
import { RedBaselineNotFailingError } from "./errors.js";
import type { GateHandler } from "./types.js";

/**
 * TDD-evidence gate — roadmap/14 §In scope, "TDD gate" bullet: "failing-
 * test-first evidence — red at base journaled before implementation
 * dispatch, green at candidate; a missing red-baseline `EvidenceRecord` for
 * the same `Requirement` fails the gate."
 *
 * `@crabgic/scheduler`'s executor ties its own `work_unit_transition`
 * `dispatched`/`succeeded` entries to this same protocol as the SEAM (its
 * own file-level doc comment: "the `dispatched` entry IS the pre-dispatch
 * red-evidence capture point ... 14 owns gate evaluation on top of these
 * two seams; this phase never itself decides gate pass/fail"). This module
 * is the "gate evaluation" half: `captureRedBaseline` is what actually
 * produces the red `EvidenceRecord` (called by whatever drives 13's
 * pre-dispatch flow, BEFORE the `verifying` stage even begins — outside the
 * registry's own fire pipeline, since the registry only fires at
 * `verifying`/`final_verifying`); `createTddGate` is the registered `tdd`
 * handler fired AT `verifying`, which checks for that red baseline's
 * existence and reports this firing's own candidate run as the green half.
 */

const TDD_GATE_TAG = "tdd";

/**
 * Journals a red-baseline `EvidenceRecord` directly (bypassing the registry
 * — this capture happens before implementation dispatch, i.e. before the
 * `verifying` stage this package's registry fires at). MUST be called with
 * `exitStatus !== 0` — throws `RedBaselineNotFailingError` otherwise (a
 * "red" baseline that already passes proves nothing about the test's
 * ability to catch a regression).
 */
export async function captureRedBaseline(
  journal: JournalStore,
  input: {
    readonly changeSetId: string;
    readonly requirementId: string;
    readonly workUnitId?: string;
    readonly baseObjectId: string;
    readonly command: string;
    readonly exitStatus: number;
    readonly toolchainFingerprint: string;
    readonly artifactDigests?: readonly string[];
    readonly now?: () => Date;
  },
): Promise<EvidenceRecord> {
  if (input.exitStatus === 0) {
    throw new RedBaselineNotFailingError(input.requirementId);
  }
  const capturedAt = (input.now?.() ?? new Date()).toISOString();
  const record: EvidenceRecord = EvidenceRecordSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    changeSetId: input.changeSetId,
    requirementId: input.requirementId,
    ...(input.workUnitId !== undefined ? { workUnitId: input.workUnitId } : {}),
    command: input.command,
    exitStatus: input.exitStatus,
    toolchainFingerprint: input.toolchainFingerprint,
    capturedAt,
    artifactDigests: input.artifactDigests ?? [],
    objectId: input.baseObjectId,
    gateTag: TDD_GATE_TAG,
  });

  await journal.appendEntry({
    type: "evidence_pointer",
    changeSetId: input.changeSetId,
    ...(input.workUnitId !== undefined ? { workUnitId: input.workUnitId } : {}),
    payload: record,
  });
  return record;
}

/** How a caller narrows what counts as a red baseline. Both bounds are optional; supplying neither reproduces the original, widest question. */
export interface RedBaselineScope {
  /** Only a record at a seq strictly below this counts — the attempt's own dispatch boundary. */
  readonly beforeSeq?: number;
  /**
   * ⚠️ THE STRUCTURAL DISCRIMINATOR, and what lets the dispatch-boundary cut be
   * relaxed for a diff-derived baseline.
   *
   * A red baseline and the TDD gate's own non-passing verdict are otherwise
   * INDISTINGUISHABLE here: both carry `gateTag: "tdd"` and a non-zero exit.
   * Owner ruling 2026-08-18's `inconclusive` state made that worse, because such
   * a firing deliberately omits its verdict too — leaving nothing at all to tell
   * the two apart.
   *
   * `captureRedBaseline` records against the FROZEN BASE object id; every gate
   * firing records against the CANDIDATE's (`../evidence.ts` takes it from the
   * `GateContext`). A gate cannot mint a record against the base without
   * actually running against the base, which is the thing being attested — so
   * this is a property of what happened, not of when it was written.
   */
  readonly baseObjectId?: string;
}

/**
 * `true` iff a red-baseline (`gateTag: "tdd"`, `exitStatus !== 0`)
 * `EvidenceRecord` has been journaled for `requirementId`, within `scope`.
 *
 * Back-compatible: the `number` form is the original `beforeSeq` argument, kept
 * so the boundary-ordering tests and criteria that cite them read unchanged.
 */
export async function hasRedBaseline(
  journal: JournalStore,
  requirementId: string,
  scope?: number | RedBaselineScope,
): Promise<boolean> {
  const { beforeSeq, baseObjectId } =
    typeof scope === "number" ? { beforeSeq: scope, baseObjectId: undefined } : (scope ?? {});
  for await (const entry of journal.queryEntries({ type: "evidence_pointer" })) {
    if (entry.type !== "evidence_pointer") continue;
    if (entry.payload.gateTag !== TDD_GATE_TAG) continue;
    if (entry.payload.requirementId !== requirementId) continue;
    if (entry.payload.exitStatus === 0) continue;
    if (baseObjectId !== undefined && entry.payload.objectId !== baseObjectId) continue;
    if (beforeSeq !== undefined && entry.seq >= beforeSeq) continue;
    return true;
  }
  return false;
}

export interface TddGateInput {
  readonly requirementId: string;
  readonly testCommand: string;
  /** The CANDIDATE run's own exit status — 0 means the (previously red) test now passes. */
  readonly exitStatus: number;
  readonly toolchainFingerprint: string;
  readonly artifactDigests?: readonly string[];
  /**
   * The journal seq boundary a red baseline must have been captured
   * STRICTLY BEFORE to count for THIS candidate's own verification (NIT-2,
   * adversarial-validation round) — e.g. the seq of the `work_unit_
   * transition: dispatched` entry that began this specific attempt (13's
   * own pre-dispatch red-evidence capture point; `@crabgic/scheduler`'s
   * `executor.ts` journals this immediately before consuming any events).
   *
   * Without this, a genuine `captureRedBaseline` call is structurally
   * INDISTINGUISHABLE, in the journal, from this SAME gate's own PRIOR
   * firing's failing verdict (also journaled with `gateTag: "tdd"` and a
   * nonzero `exitStatus` whenever no red baseline was found yet) — so a
   * gate that fires once (failing, no baseline captured), then fires AGAIN
   * later reporting green, would incorrectly treat its OWN earlier failing
   * verdict as if it were a legitimate pre-dispatch red baseline, without
   * `captureRedBaseline` ever having been genuinely called. Requiring the
   * red baseline to precede a caller-supplied dispatch boundary — which
   * every 'verifying'/'final_verifying'-stage gate firing happens AFTER —
   * closes this: neither this gate's own repeated firings nor a red
   * baseline fabricated retroactively (after the fact) can ever have a seq
   * before the candidate's own dispatch began.
   */
  readonly beforeSeq: number;
}

/**
 * The registered `tdd` gate handler — fired at `verifying`/`final_verifying`.
 * Fails (verdict.passed = false) when no red-baseline `EvidenceRecord`
 * exists yet, STRICTLY BEFORE `input.beforeSeq`, for `input.requirementId`
 * (roadmap/14's own failing-first instruction: "a fixture attempt missing a
 * red-baseline `EvidenceRecord` for its `Requirement` is rejected"; NIT-2:
 * a red baseline recorded at or after the candidate's own dispatch boundary
 * — including this gate's own prior failing verdict — never counts). When
 * a red baseline DOES exist before that boundary, this firing's own
 * candidate run is the green half — `passed` mirrors
 * `input.exitStatus === 0` directly.
 */
export function createTddGate(input: TddGateInput): GateHandler {
  return async (context) => {
    const redExists = await hasRedBaseline(context.journal, input.requirementId, input.beforeSeq);
    if (!redExists) {
      return {
        passed: false,
        command: input.testCommand,
        exitStatus: input.exitStatus,
        toolchainFingerprint: input.toolchainFingerprint,
        artifactDigests: input.artifactDigests ?? [],
        detail: `no red-baseline EvidenceRecord found for requirement "${input.requirementId}" — TDD gate fails closed`,
      };
    }
    const passed = input.exitStatus === 0;
    return {
      passed,
      command: input.testCommand,
      exitStatus: input.exitStatus,
      toolchainFingerprint: input.toolchainFingerprint,
      artifactDigests: input.artifactDigests ?? [],
      detail: passed
        ? `red-baseline confirmed; candidate is green for requirement "${input.requirementId}"`
        : `red-baseline confirmed, but candidate is still failing for requirement "${input.requirementId}"`,
    };
  };
}
