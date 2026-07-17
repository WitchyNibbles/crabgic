import {
  JournalEntryTypeSchema,
  WorkUnitAttemptStatusSchema,
  type JournalEntryType,
  type WorkUnitAttemptStatus,
} from "@eo/contracts";

/**
 * Instance builders for the two new closed unions roadmap/02-contracts-and-
 * schemas.md work item 10 names alongside the 21 contract fixtures:
 * `WorkUnitAttemptStatus` and `JournalEntryType`. Unlike the 21 contract
 * builders, these unions have no object shape to default-and-merge — a
 * "builder" here is a thin, schema-validated identity function so the
 * meta-test can exercise them the same way it exercises every contract
 * builder (roadmap/02 exit criterion: "Testkit fixture builders exist for
 * all 21 contracts plus both new unions, each producing an instance that
 * validates against its own schema").
 */

/** Defaults to `"pending"` — the union's own initial state (see `WorkUnitAttemptStatusSchema`'s own doc comment). */
export function buildWorkUnitAttemptStatus(
  value: WorkUnitAttemptStatus = "pending",
): WorkUnitAttemptStatus {
  return WorkUnitAttemptStatusSchema.parse(value);
}

/** Defaults to `"run_transition"` — the first-declared member of the 13-member closed union. */
export function buildJournalEntryType(
  value: JournalEntryType = "run_transition",
): JournalEntryType {
  return JournalEntryTypeSchema.parse(value);
}
