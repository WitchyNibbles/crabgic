import { createHash } from "node:crypto";

/**
 * The one shape every attestation check in this project returns.
 *
 * Deliberately NOT a boolean: an emitter that only knew "pass/fail" would
 * journal an `EvidenceRecord` whose non-zero `exitStatus` a reviewer could
 * not act on. `reasons` is the machine-readable account of WHY a check
 * failed — it is what makes a FAIL here a finding rather than a mystery.
 *
 * INVARIANT (asserted by `checkResult.test.ts`, and relied on by
 * `evidence.ts`): `verdict === "PASS"` iff `reasons` is empty. A check must
 * never return a PASS carrying unresolved reasons, and never a FAIL with no
 * stated reason. `buildCheckResult` is the only sanctioned constructor
 * precisely so that invariant cannot be violated by hand-assembly.
 */
export interface AttestationCheckResult {
  readonly verdict: "PASS" | "FAIL";
  /** Non-empty iff `verdict === "FAIL"` — one entry per distinct failing condition. */
  readonly reasons: readonly string[];
  /**
   * Human-readable facts the check established, pass or fail (e.g. "4/4
   * release docs are git-tracked"). Digested into the emitted
   * `EvidenceRecord.artifactDigests`, never inlined as raw output — per
   * `EvidenceRecord.artifactDigests`'s own contract.
   */
  readonly details: readonly string[];
}

/** The ONLY sanctioned constructor: derives `verdict` from `reasons` so a PASS-with-reasons is unrepresentable. */
export function buildCheckResult(
  reasons: readonly string[],
  details: readonly string[] = [],
): AttestationCheckResult {
  return {
    verdict: reasons.length === 0 ? "PASS" : "FAIL",
    reasons: [...reasons],
    details: [...details],
  };
}

/** Deterministic content digest — the `sha256:`-prefixed form `EvidenceRecord.artifactDigests` requires. */
export function digestArtifact(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

/**
 * The digest set journaled for a check result: one digest over the reasons
 * and one over the details, so an archived report can be spot-checked
 * against a re-run without the journal ever carrying the raw text.
 */
export function digestCheckResult(result: AttestationCheckResult): readonly string[] {
  return [
    digestArtifact(`reasons:${result.reasons.join("\n")}`),
    digestArtifact(`details:${result.details.join("\n")}`),
  ];
}
