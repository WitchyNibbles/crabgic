/**
 * The neutral-rendering assertion — roadmap/23-release-hardening.md work
 * item 5's fail-first vector, verbatim: "a seeded commit body carrying a
 * dev-engine attribution leak ('Generated with', 'Co-Authored-By: …
 * Claude…') must FAIL the neutral-rendering assertion." This module IS
 * "the assertion" that vector refers to: a pure function over a candidate
 * string (no I/O), built on `@crabgic/contracts`'s `scanForAttributionTokens` —
 * the SAME shared primitive 17's lint stage and 08's own publish-time
 * belt-and-suspenders re-scan already build on (never forked here either).
 * Its own correctness is proven with a seeded leak string BEFORE any real
 * renderer/`publishLocal` call ever runs (see
 * `test/neutral-rendering-assertion.test.ts`'s RED/GREEN pair) — this
 * project's own independent verification layer, reused again inside
 * `scenarios/branch-commit-golden-scenarios.ts` and
 * `scenarios/publish-attribution-leak-scenario.ts` as a second, harness-
 * owned check alongside each real subsystem's own guard.
 */
import { scanForAttributionTokens, type AttributionFinding } from "@crabgic/contracts";

/** Every attribution-token occurrence in `text` — a thin, directly-named re-export of `@crabgic/contracts`'s shared scanner, kept as a named function here so a call site reads as "this harness's own assertion," not a stray import. */
export function findAttributionLeaks(text: string): readonly AttributionFinding[] {
  return scanForAttributionTokens(text);
}

export class AttributionLeakError extends Error {
  readonly findings: readonly AttributionFinding[];

  constructor(findings: readonly AttributionFinding[]) {
    const tokens = findings.map((f) => `"${f.token}" (line ${String(f.line)})`).join(", ");
    super(
      `git-matrix: neutral-rendering assertion failed — ${String(findings.length)} attribution token(s) found: ${tokens}`,
    );
    this.name = "AttributionLeakError";
    this.findings = findings;
  }
}

/** Throws `AttributionLeakError` if `text` carries any attribution token; otherwise resolves silently. */
export function assertNeutralRendering(text: string): void {
  const findings = findAttributionLeaks(text);
  if (findings.length > 0) {
    throw new AttributionLeakError(findings);
  }
}
