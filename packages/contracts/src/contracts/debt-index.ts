import { normalizePathPrefix } from "./envelope-policy.js";
import type { ReviewFinding } from "./review-verdict.js";

/**
 * Deferred debt, and how it comes back.
 *
 * Owner ruling 2026-07-29 (`docs/staged-review-pipeline.md` §7.3): an advisory
 * finding disposed as `accepted-debt` becomes `blocking` the moment a later
 * change set's planned writes intersect the paths it concerns. Debt is paid at
 * the cheapest moment — when someone is already in that code with the context
 * loaded — and nothing accumulates silently.
 *
 * This module is the reason `advisory` is a deferral rather than a disposal.
 * Without it the severity floor would be exactly the escape hatch the ledger
 * warned against, where a real defect is filed once and never seen again.
 */

/**
 * Segment-aware containment, in BOTH directions, using the repository's one
 * canonical normalizer.
 *
 * `normalizePathPrefix` is imported rather than reimplemented, and that is
 * load-bearing rather than tidy: rounds 4-7 each tried to keep a second path
 * matcher in step with it, every attempt diverged somewhere new, and round 7
 * measured the last one making mismatches SIX TIMES worse over a 51,911-prefix
 * corpus. Two functions that must agree will not.
 *
 * Both directions matter. Debt on a directory is touched by a write to a file
 * inside it, and debt on a file is touched by a change set that rewrites the
 * directory above it. Only one of those is "prefix matching" in the usual
 * sense, and checking only one would silently miss half the debt.
 */
function touches(debtPath: string, writtenPath: string): boolean {
  const debt = normalizePathPrefix(debtPath);
  const written = normalizePathPrefix(writtenPath);
  if (debt === undefined || written === undefined) return false;
  if (debt === written) return true;
  // `startsWith(x + "/")` and never `startsWith(x)`: `src` contains `src/login`
  // and does not contain `srcfoo`. A raw prefix match is the confinement class
  // this repository has already paid for once.
  return written.startsWith(`${debt}/`) || debt.startsWith(`${written}/`);
}

/** The debt a change set's planned writes reopen. */
export function selectDebtTouchedBy(
  findings: readonly ReviewFinding[],
  plannedWrites: readonly string[],
): readonly ReviewFinding[] {
  if (plannedWrites.length === 0) return [];
  return findings.filter(
    (finding) =>
      finding.disposition === "accepted-debt" &&
      finding.paths.some((debtPath) => plannedWrites.some((written) => touches(debtPath, written))),
  );
}

/**
 * The exit criterion a reopened debt violates.
 *
 * A `blocking` finding must name the criterion it violates or `ReviewFindingSchema`
 * refuses it, so reopening has to supply one — otherwise this function would
 * produce a finding the schema cannot represent, which is the kind of internal
 * disagreement round 7 is about.
 */
export const DEBT_REOPENED_CRITERION = "no-open-debt-in-touched-paths";

/**
 * Reopen the debt a change set touches; leave everything else exactly as it is.
 *
 * The disposition is **cleared**, not rewritten. A reopened finding is an open
 * finding, and a stage may not advance holding one — which is precisely what
 * makes deferring different from dropping. The original evidence is preserved
 * so the reopened finding is still falsifiable without re-deriving it.
 */
export function reclassifyDebtForWriteSet(
  findings: readonly ReviewFinding[],
  plannedWrites: readonly string[],
): readonly ReviewFinding[] {
  const reopened = new Set(
    selectDebtTouchedBy(findings, plannedWrites).map((finding) => finding.id),
  );
  if (reopened.size === 0) return findings;
  return findings.map((finding) => {
    if (!reopened.has(finding.id)) return finding;
    const { disposition: _cleared, dispositionEvidence: _also, ...rest } = finding;
    return {
      ...rest,
      classification: "blocking",
      violates: finding.violates ?? DEBT_REOPENED_CRITERION,
    } satisfies ReviewFinding;
  });
}
