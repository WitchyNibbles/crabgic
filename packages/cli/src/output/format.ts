/**
 * stdout/stderr/exit-code conventions — RELOCATED to `@eo/contracts`
 * (2026-07-25) and re-exported here verbatim. Implementation:
 * `packages/contracts/src/cli-surface/command-result.ts`. `../bin.ts` is
 * still the sole place that writes to the real `process.stdout`/
 * `process.stderr` and calls `process.exit`.
 */
export { formatJson } from "@eo/contracts";
export type { CommandResult } from "@eo/contracts";
