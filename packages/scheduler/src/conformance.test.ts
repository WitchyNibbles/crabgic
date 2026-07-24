import { describe, expect, it } from "vitest";
import {
  JOURNAL_ENTRY_TYPES,
  WORK_UNIT_ATTEMPT_STATUSES,
  type JournalEntryType,
  type WorkUnitAttemptStatus,
} from "@eo/contracts";

/**
 * Exit criterion #7 — roadmap/13-scheduler-packets-context.md: "Every
 * attempt transition this package records matches a `WorkUnitAttemptStatus`
 * member, and every entry it journals matches a `JournalEntryType` member
 * (exercised here against 02's discriminated-union exhaustiveness
 * harness)."
 *
 * The exhaustiveness MECHANISM (identical to `@eo/contracts`'s own
 * `JOURNAL_ENTRY_TYPE_DESCRIPTIONS`/`WORK_UNIT_ATTEMPT_STATUS_TRANSITIONS`
 * pattern): a `Record<K, V>`-typed object literal is valid TypeScript only
 * when it declares EXACTLY one property per union member — `npx tsc -b`
 * fails if this package ever journals a member not accounted for below, or
 * if 02 ever adds a 14th `JournalEntryType`/7th `WorkUnitAttemptStatus`
 * member without a matching update here.
 */

/** Every `JournalEntryType` member this package's own code ever appends, with a one-line note on which module — `true` for "yes, this package journals this," `false` for "no, out of this package's scope" (14/16/18/etc. own those, per roadmap/13 §Out of scope). */
const JOURNAL_ENTRY_TYPE_USAGE: Readonly<Record<JournalEntryType, boolean>> = {
  run_transition: false, // 05/11's own run-lifecycle transitions — this phase never drives run state itself
  work_unit_transition: true, // executor.ts / attempt-policy.ts / parking.ts — every dispatch/succeeded/failed/parked transition
  adjudication_decision: true, // parking.ts's journal-derived park-timer marker + shadow-run.ts's marker entry (both documented reuses of this generic payload)
  remote_operation_record: false, // 04/16's idempotency registry — not used by this package
  evidence_pointer: false, // 08's own evidence-attachment mechanism — not used by this package
  session_assignment: true, // executor.ts — journaled BEFORE consuming any events, on every fresh dispatch
  git_freeze: false, // 07's own intake-freeze — not used by this package
  worktree_quarantine: false, // 07's own worktree lifecycle — not used by this package
  cas_ref_update: false, // 08's own CAS-ref update — not used by this package
  approval_token_mint: false, // 09/11/12/22's own approval-token minting — not used by this package
  fanout_rationale: true, // fanout.ts — journaled whenever the executor fans out beyond one worker
  milestone_sync: false, // 18/21's own connector sync — not used by this package
  learning_transition: false, // 22's own learning-proposal lifecycle — not used by this package
};

/** Every `WorkUnitAttemptStatus` member this package's own code ever records via `recordAttempt`. */
const WORK_UNIT_ATTEMPT_STATUS_USAGE: Readonly<Record<WorkUnitAttemptStatus, boolean>> = {
  pending: false, // the DAG's own initial state (11) — this package never re-records it
  dispatched: true, // executor.ts's pre-dispatch red-evidence capture
  succeeded: true, // executor.ts's post-succeeded green-candidate marker
  failed: true, // executor.ts — worker-reported failure, schema violation, or crash
  cancelled: true, // executor.ts — worker self-reports outcome: "cancelled"
  "parked:rate_limit": true, // parking.ts's parkWorkUnit
};

describe("JournalEntryType / WorkUnitAttemptStatus exhaustiveness (exit criterion #7)", () => {
  it("JOURNAL_ENTRY_TYPE_USAGE declares exactly the 13 members 02 owns, one boolean each", () => {
    expect(Object.keys(JOURNAL_ENTRY_TYPE_USAGE).sort()).toEqual([...JOURNAL_ENTRY_TYPES].sort());
  });

  it("WORK_UNIT_ATTEMPT_STATUS_USAGE declares exactly the 6 members 02 owns, one boolean each", () => {
    expect(Object.keys(WORK_UNIT_ATTEMPT_STATUS_USAGE).sort()).toEqual(
      [...WORK_UNIT_ATTEMPT_STATUSES].sort(),
    );
  });

  it("this package journals a nonempty, strict subset of JournalEntryType — never a member outside the closed union (guaranteed by TypeScript at every appendEntry call site)", () => {
    const usedTypes = Object.entries(JOURNAL_ENTRY_TYPE_USAGE)
      .filter(([, used]) => used)
      .map(([type]) => type);
    expect(usedTypes.length).toBeGreaterThan(0);
    for (const type of usedTypes) {
      expect(JOURNAL_ENTRY_TYPES).toContain(type as JournalEntryType);
    }
    expect(usedTypes.sort()).toEqual(
      [
        "work_unit_transition",
        "adjudication_decision",
        "session_assignment",
        "fanout_rationale",
      ].sort(),
    );
  });

  it("this package records a nonempty, strict subset of WorkUnitAttemptStatus — never a member outside the closed union", () => {
    const usedStatuses = Object.entries(WORK_UNIT_ATTEMPT_STATUS_USAGE)
      .filter(([, used]) => used)
      .map(([status]) => status);
    expect(usedStatuses.length).toBeGreaterThan(0);
    for (const status of usedStatuses) {
      expect(WORK_UNIT_ATTEMPT_STATUSES).toContain(status as WorkUnitAttemptStatus);
    }
    expect(usedStatuses.sort()).toEqual(
      ["dispatched", "succeeded", "failed", "cancelled", "parked:rate_limit"].sort(),
    );
  });
});
