/**
 * Stable exit codes — RELOCATED to `@eo/contracts` (2026-07-25) and
 * re-exported here verbatim. Implementation:
 * `packages/contracts/src/cli-surface/exit-codes.ts`, which explains why
 * (command backends outside `packages/cli` — phase 12's `trust *`, in
 * `packages/detect` — need the same vocabulary, and reaching it from here
 * closed a build-breaking dependency cycle).
 */
export {
  EXIT_DOCTOR_FINDINGS,
  EXIT_GENERAL_ERROR,
  EXIT_NOT_IMPLEMENTED,
  EXIT_OK,
  EXIT_SECRET_REJECTED,
  EXIT_SUPERVISOR_UNAVAILABLE,
  EXIT_USAGE_ERROR,
} from "@eo/contracts";
export type { ExitCode } from "@eo/contracts";
