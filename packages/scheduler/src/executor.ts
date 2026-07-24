/**
 * Executor — roadmap/13-scheduler-packets-context.md §In scope, "DAG
 * executor" + "Attempt policy" + "Scheduler half of the TDD evidence
 * protocol." Ties `./readiness.ts`, `./fanout.ts`, `./attempt-policy.ts`,
 * `./budgets.ts`, `./worker-result-validation.ts`, and `./parking.ts`
 * together into the actual dispatch loop over `@eo/engine-core`'s
 * `EngineAdapter` — the sole mechanism for turning a ready `WorkUnit` +
 * `TaskPacket` into a running attempt (roadmap/13 §Interfaces consumed).
 *
 * Worker lifecycle mechanics themselves (spawn/reap/log-ring-buffer/UDS
 * surface, 05) are NOT reimplemented here — this module calls
 * `EngineAdapter.spawn`/`resume` directly (the abstract 03 contract) and
 * does its own minimal journaling (`session_assignment`,
 * `work_unit_transition`) via `@eo/journal`'s existing `recordAttempt`,
 * exactly mirroring 05's own `worker-lifecycle-manager.ts` ordering
 * (`session_assignment` BEFORE consuming any events) without depending on
 * `@eo/supervisor` at all — this phase's own minimal-sufficient choice,
 * documented in the evidence doc's deviations section.
 *
 * EVIDENCE SEAM (roadmap/13 §In scope, "Scheduler half of the TDD evidence
 * protocol"): "journal a base-revision (red) evidence capture immediately
 * before an attempt is dispatched, and mark the candidate (green)
 * available immediately after a `succeeded` transition." This is
 * satisfied by construction: the `work_unit_transition` "dispatched" entry
 * IS the pre-dispatch red-evidence capture point, and the
 * `work_unit_transition` "succeeded" entry IS the post-success green
 * marker — no separate journal entry type exists for this (14 owns gate
 * evaluation on top of these two seams; this phase never itself decides
 * gate pass/fail).
 *
 * MAJOR-1 fix (adversarial-validation round): `resumeAttempt` used to
 * record a `dispatched` transition and consume the same event-consumption
 * pipeline WITHOUT ever calling `assertRepairAllowed` — since
 * crash-recovery repair explicitly routes through `resume` ("same
 * recovery machinery, different trigger," roadmap/13 §In scope), this let
 * a caller bypass the 1-initial-plus-2-repairs cap and the "no new
 * evidence" refusal entirely by resuming instead of freshly dispatching
 * (reproduced in `executor.test.ts`'s own vulnerability-proof test, since
 * fixed below). The roadmap ALSO explicitly treats limit-park resume as
 * NOT a repair ("account-wide signals pause globally... parking timers
 * derived from journal" — an external throttle, not a failed action) —
 * `resumeAttempt` now takes a REQUIRED `trigger` discriminant so the two
 * cases are never conflated: `{kind: "crashRepair", evidenceKind, ...}`
 * routes through the IDENTICAL `assertRepairAllowed` gate `dispatchAttempt`
 * uses (and so counts toward the cap, correctly, via `../attempt-policy.ts`'s
 * own `previousStatus`-based exclusion of park-resumes); `{kind:
 * "parkResume"}` skips the gate entirely and requires no evidence, matching
 * "same recovery machinery, different trigger" — a park-resume's own
 * `previousStatus` will read `parked:rate_limit`, which
 * `countPriorDispatches` already excludes from the repair-cap count
 * regardless of which code path recorded it, so the two halves of this fix
 * (the executor-level gate here, and the counting fix in
 * `../attempt-policy.ts`) are mutually reinforcing, not redundant.
 *
 * MINOR-3 fix (adversarial-validation round): both `dispatchAttempt` and
 * `resumeAttempt` now call `../parking.ts`'s `assertNotGloballyPaused`
 * FIRST, before any other check — "account-wide signals pause globally"
 * (roadmap/13 §In scope) is now an ENFORCED dispatch-time gate, not merely
 * an exported, unconsulted predicate.
 */

import { recordAttempt, type JournalStore } from "@eo/journal";
import type {
  AdjudicationCallback,
  CompiledWorkerProfile,
  EngineAdapter,
  EngineEvent,
  SessionRef,
} from "@eo/engine-core";
import type { TaskPacket, WorkerResult } from "@eo/contracts";
import { assertPacketWithinBudget } from "./budgets.js";
import { assertRepairAllowed, type AttemptEvidenceKind } from "./attempt-policy.js";
import { assertNotGloballyPaused, parkWorkUnit } from "./parking.js";
import { validateWorkerResult } from "./worker-result-validation.js";

/** Default clock — epoch SECONDS, matching `EngineLimitSignalEvent.resetsAt` (docs/engine-baseline.md §8). Overridable for deterministic tests. */
function defaultNowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export type DispatchAttemptOutcome =
  | { readonly kind: "succeeded"; readonly sessionId: string; readonly result: WorkerResult }
  | { readonly kind: "cancelled"; readonly sessionId: string; readonly result: WorkerResult }
  | {
      readonly kind: "failed";
      readonly sessionId: string;
      readonly evidenceKind: Exclude<AttemptEvidenceKind, "none">;
      readonly diagnostics: readonly string[];
      readonly result?: WorkerResult;
    }
  | { readonly kind: "crashed"; readonly sessionId: string; readonly evidenceKind: "crash" }
  | {
      readonly kind: "parked";
      readonly sessionId: string;
      readonly resetsAt: number;
      readonly accountWide: boolean;
    };

interface ConsumeEventsParams {
  readonly events: AsyncIterable<EngineEvent>;
  readonly journal: JournalStore;
  readonly workUnitId: string;
  readonly sessionId: string;
}

/** Shared event-consumption loop between a fresh dispatch and a resume — see file-level doc comment. */
async function consumeEvents(params: ConsumeEventsParams): Promise<DispatchAttemptOutcome> {
  for await (const event of params.events) {
    if (event.type === "limitSignal") {
      const accountWide = event.status === "rejected" || event.errorCode === "credits_required";
      await parkWorkUnit({
        journal: params.journal,
        workUnitId: params.workUnitId,
        sessionId: params.sessionId,
        resetsAt: event.resetsAt,
        accountWide,
      });
      return { kind: "parked", sessionId: params.sessionId, resetsAt: event.resetsAt, accountWide };
    }

    if (event.type === "result") {
      const validation = validateWorkerResult(event);

      if (validation.kind === "schemaViolation") {
        await recordAttempt(params.journal, params.workUnitId, params.sessionId, "failed");
        return {
          kind: "failed",
          sessionId: params.sessionId,
          evidenceKind: "schemaViolation",
          diagnostics: validation.diagnostics,
        };
      }

      if (validation.result.outcome === "succeeded") {
        // Post-succeeded GREEN candidate-availability marker.
        await recordAttempt(params.journal, params.workUnitId, params.sessionId, "succeeded");
        return { kind: "succeeded", sessionId: params.sessionId, result: validation.result };
      }
      if (validation.result.outcome === "cancelled") {
        await recordAttempt(params.journal, params.workUnitId, params.sessionId, "cancelled");
        return { kind: "cancelled", sessionId: params.sessionId, result: validation.result };
      }
      // outcome === "failed"
      await recordAttempt(params.journal, params.workUnitId, params.sessionId, "failed");
      return {
        kind: "failed",
        sessionId: params.sessionId,
        evidenceKind: "workerResultFailure",
        diagnostics: validation.result.diagnostics,
        result: validation.result,
      };
    }
  }

  // Stream ended with no terminal result/limitSignal event at all — a crash.
  await recordAttempt(params.journal, params.workUnitId, params.sessionId, "failed");
  return { kind: "crashed", sessionId: params.sessionId, evidenceKind: "crash" };
}

export interface DispatchAttemptOptions {
  readonly adapter: EngineAdapter;
  readonly journal: JournalStore;
  readonly packet: TaskPacket;
  readonly profile: CompiledWorkerProfile;
  readonly adjudicate: AdjudicationCallback;
  /**
   * Why this attempt is justified. Ignored (no evidence required) for the
   * work unit's very first dispatch; required (and validated against the
   * journal-derived attempt count) for every subsequent repair — see
   * `../attempt-policy.ts`.
   */
  readonly evidenceKind: AttemptEvidenceKind;
  /** Optional evidence-distinctness fingerprint — see `../attempt-policy.ts`'s `assertRepairAllowed` doc comment. */
  readonly evidenceDetail?: string;
  readonly runId?: string;
  /** Epoch-seconds clock, for `assertNotGloballyPaused` — overridable for deterministic tests. Defaults to the real wall clock. */
  readonly nowSeconds?: () => number;
}

/**
 * Dispatches a NEW attempt (fresh session) for `options.packet.workUnitId`.
 * Enforces, in order: (1) no account-wide rate-limit pause is active
 * (`GlobalPauseActiveError`), (2) the packet's own size budget (never
 * silently truncated — `PacketBudgetExceededError`), (3) the attempt-
 * repair policy (`RepairEvidenceRequiredError`). Journals
 * `session_assignment` BEFORE consuming any events, then
 * `work_unit_transition("dispatched")` — the pre-dispatch red-evidence
 * capture point.
 */
export async function dispatchAttempt(
  options: DispatchAttemptOptions,
): Promise<DispatchAttemptOutcome> {
  const nowSecondsFn = options.nowSeconds ?? defaultNowSeconds;
  await assertNotGloballyPaused(options.journal, nowSecondsFn());

  assertPacketWithinBudget(options.packet);
  await assertRepairAllowed(
    options.journal,
    options.packet.workUnitId,
    options.evidenceKind,
    options.evidenceDetail,
  );

  const handle = options.adapter.spawn(options.packet, options.profile, options.adjudicate);
  const sessionId = handle.sessionRef.sessionId;
  const workUnitId = options.packet.workUnitId;

  await options.journal.appendEntry({
    type: "session_assignment",
    ...(options.runId !== undefined ? { runId: options.runId } : {}),
    workUnitId,
    payload: { sessionId },
  });
  // Pre-dispatch base-revision RED evidence capture point.
  await recordAttempt(options.journal, workUnitId, sessionId, "dispatched");

  return consumeEvents({ events: handle.events, journal: options.journal, workUnitId, sessionId });
}

/**
 * Which of the two resume triggers this call is (MAJOR-1 fix — see
 * file-level doc comment): a crash-recovery REPAIR (gated identically to
 * `dispatchAttempt`, consumes a repair slot) or a rate-limit-park RESUME
 * (never gated, never consumes a repair slot — an external throttle, not
 * a failed action).
 */
export type ResumeTrigger =
  | {
      readonly kind: "crashRepair";
      readonly evidenceKind: AttemptEvidenceKind;
      readonly evidenceDetail?: string;
    }
  | { readonly kind: "parkResume" };

export interface ResumeAttemptOptions {
  readonly adapter: EngineAdapter;
  readonly journal: JournalStore;
  readonly sessionRef: SessionRef;
  readonly workUnitId: string;
  readonly adjudicate: AdjudicationCallback;
  readonly trigger: ResumeTrigger;
  /** Epoch-seconds clock, for `assertNotGloballyPaused` — overridable for deterministic tests. Defaults to the real wall clock. */
  readonly nowSeconds?: () => number;
}

/**
 * Resumes an EXISTING session — either a crash-recovery REPAIR
 * (`trigger.kind === "crashRepair"`) or a rate-limit-park RESUME
 * (`trigger.kind === "parkResume"`); see `ResumeTrigger`'s own doc
 * comment and this file's MAJOR-1 fix note for why these are gated
 * completely differently. `"crashRepair"` calls the IDENTICAL
 * `assertRepairAllowed` gate `dispatchAttempt` uses (throws
 * `RepairEvidenceRequiredError` exactly as a fresh dispatch would);
 * `"parkResume"` skips it entirely — no evidence is required, and (via
 * `../attempt-policy.ts`'s own `previousStatus`-based exclusion) the
 * resulting `dispatched` transition never consumes a repair slot either
 * way.
 */
export async function resumeAttempt(
  options: ResumeAttemptOptions,
): Promise<DispatchAttemptOutcome> {
  const nowSecondsFn = options.nowSeconds ?? defaultNowSeconds;
  await assertNotGloballyPaused(options.journal, nowSecondsFn());

  if (options.trigger.kind === "crashRepair") {
    await assertRepairAllowed(
      options.journal,
      options.workUnitId,
      options.trigger.evidenceKind,
      options.trigger.evidenceDetail,
    );
  }
  // trigger.kind === "parkResume": deliberately NO gate call at all — a
  // rate-limit-park resume is never a repair (see file-level doc comment).

  const handle = options.adapter.resume(options.sessionRef, options.adjudicate);
  const sessionId = handle.sessionRef.sessionId;

  await recordAttempt(options.journal, options.workUnitId, sessionId, "dispatched");

  return consumeEvents({
    events: handle.events,
    journal: options.journal,
    workUnitId: options.workUnitId,
    sessionId,
  });
}
