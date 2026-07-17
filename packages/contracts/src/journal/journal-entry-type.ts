import { z } from "zod";

/**
 * `JournalEntryType` — a closed, 13-member discriminated union; every
 * journal entry (04) carries exactly one member (roadmap/02-contracts-and-
 * schemas.md §In scope, "`JournalEntryType`" bullet; work item 5;
 * interface-ledger Gap 5 ruling).
 *
 * Rate-limit-park events are `work_unit_transition` entries — their status
 * field carries `WorkUnitAttemptStatus`'s `parked:rate_limit` member (see
 * `../state-machines/work-unit-attempt-status.ts`). There is NO separate
 * `rate_limit_park` member; one of the four independent resolver passes
 * behind Gap 5's ruling made exactly this mistake (kept `rate_limit_park`
 * alongside `work_unit_transition` while claiming "13 members" with 14
 * distinct tokens) and was rejected for it — ledger Gap 5, "Where the 4
 * resolvers disagreed."
 *
 * This union is closed at exactly 13. A 14th member requires a new
 * coordinated cross-phase resolution round (interface-ledger header
 * preamble), never a unilateral addition here — roadmap/02 §Risks & open
 * questions: phase 12 has flagged, but explicitly not resolved, that
 * capability-audit pass/fail verdicts have no clean dedicated member; that
 * tension stays open and is not grounds to add a 14th member unilaterally.
 */
export const JOURNAL_ENTRY_TYPES = [
  "run_transition",
  "work_unit_transition",
  "adjudication_decision",
  "remote_operation_record",
  "evidence_pointer",
  "session_assignment",
  "git_freeze",
  "worktree_quarantine",
  "cas_ref_update",
  "approval_token_mint",
  "fanout_rationale",
  "milestone_sync",
  "learning_transition",
] as const;

export const JournalEntryTypeSchema = z.enum(JOURNAL_ENTRY_TYPES);
export type JournalEntryType = z.infer<typeof JournalEntryTypeSchema>;

/**
 * The exhaustiveness mechanism (roadmap/02 work item 5 / exit criterion):
 * a `Record<JournalEntryType, string>` descriptor literal is valid
 * TypeScript only when it declares EXACTLY one property per union member —
 * TS's excess/missing-property checking on an object literal assigned to a
 * `Record<K, V>`-typed binding rejects both a missing key (an uncovered
 * member) and a stray extra key. Adding a 14th member to
 * `JOURNAL_ENTRY_TYPES` without adding a matching key here fails
 * `npx tsc -b packages/contracts`; so does the reverse (a stray key with no
 * corresponding union member). Demonstrated by temporarily stubbing a 14th
 * category in the test harness only — see
 * `docs/evidence/phase-02/wi5-journal-14th-member-tsc-failing.txt` and
 * `wi5-journal-tsc-clean.txt`.
 *
 * Doubles as a genuine one-line human-readable description per member,
 * consumable by anything that renders a journal entry for a human (e.g.
 * the `status`/`evidence` CLI output, 09).
 */
export const JOURNAL_ENTRY_TYPE_DESCRIPTIONS: Readonly<Record<JournalEntryType, string>> = {
  run_transition: "A Run-lifecycle state transition (state machine owned by this phase).",
  work_unit_transition:
    "A WorkUnitAttemptStatus transition, including rate-limit-park events (status: parked:rate_limit) — there is no separate rate_limit_park member.",
  adjudication_decision:
    "A human or policy adjudication decision recorded against a Run or WorkUnit.",
  remote_operation_record:
    "A pre-I/O record of a planned remote mutation (16's idempotency registry, 04).",
  evidence_pointer:
    "A pointer to an attached EvidenceRecord (e.g. rendered PR/review-comment artifacts, 08).",
  session_assignment: "An engine session assigned to a WorkUnit (06).",
  git_freeze: "A control-repo or worktree freeze event (07).",
  worktree_quarantine: "A worktree quarantine event (07).",
  cas_ref_update: "A content-addressed-store reference update (08).",
  approval_token_mint: "A `trust approve`-style approval token mint (09/11/12/22).",
  fanout_rationale: "The scheduler's rationale for a fan-out decision (13).",
  milestone_sync: "A milestone synchronization event against an external tracker (18/21).",
  learning_transition: "A LearningProposalState transition (22).",
};
