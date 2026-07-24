/**
 * Stable exit codes — roadmap/09-cli-and-doctor.md §Conventions: "stable
 * exit codes." Every command backend, present or later-wired, returns one
 * of exactly these — never an ad hoc number invented at a call site. Loosely
 * follows BSD `sysexits.h` conventions where one already fits.
 *
 * WHY THIS LIVES IN `@eo/contracts` (2026-07-25): "every command backend"
 * includes backends that live OUTSIDE `packages/cli` — phase 12's `trust
 * review`/`approve`/`revoke` are implemented in `packages/detect`, which
 * reached these constants through the CLI package and so closed a cycle
 * (`cli -> learning -> gates -> detect -> cli`) that made `tsc -b` fail
 * from a clean checkout. A shared exit-code vocabulary is a contract, not a
 * CLI implementation detail, so it belongs at the dependency-graph root.
 * `engineering-orchestrator` re-exports every name verbatim.
 */
export const EXIT_OK = 0;
export const EXIT_GENERAL_ERROR = 1;
/** Malformed invocation (`sysexits.h` `EX_USAGE`). */
export const EXIT_USAGE_ERROR = 64;
/** The requested command has no backend wired yet. */
export const EXIT_NOT_IMPLEMENTED = 69;
/** A literal secret-shaped value was rejected in argv. */
export const EXIT_SECRET_REJECTED = 77;
/** The supervisor's UDS control socket could not be reached. */
export const EXIT_SUPERVISOR_UNAVAILABLE = 71;
/** `doctor` (non-`--json`) found at least one failing check. */
export const EXIT_DOCTOR_FINDINGS = 2;

export type ExitCode =
  | typeof EXIT_OK
  | typeof EXIT_GENERAL_ERROR
  | typeof EXIT_USAGE_ERROR
  | typeof EXIT_NOT_IMPLEMENTED
  | typeof EXIT_SECRET_REJECTED
  | typeof EXIT_SUPERVISOR_UNAVAILABLE
  | typeof EXIT_DOCTOR_FINDINGS;
