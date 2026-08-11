/**
 * Human-mode stdout primitives — RELOCATED to `@crabgic/contracts`
 * (2026-08-11) and re-exported here verbatim, in the manner of `./format.ts`.
 * Implementation: `packages/contracts/src/presentation/human-report.ts`.
 *
 * The move was forced by `trust review|approve|revoke`, whose backend lives in
 * `packages/detect`: `packages/cli` depends on `packages/detect`, so these
 * could not be reached from there without inverting that edge. See that file's
 * own note, and `docs/presentation-policy.md`.
 *
 * `../bin.ts` is still the sole place that writes to the real
 * `process.stdout`/`process.stderr`.
 */
export {
  renderBullets,
  renderHeading,
  renderHumanReport,
  renderKeyValues,
  renderStatusLine,
} from "@crabgic/contracts";
export type { HumanReport, HumanReportSection, KeyValueRow } from "@crabgic/contracts";
