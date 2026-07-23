import type { CommunicationPolicy } from "@eo/contracts";
import type { ArtifactKind } from "./artifact-kind.js";

/**
 * `LintFinding` — roadmap/17 §Interfaces produced, verbatim: "one entry per
 * violation, never a bare boolean, so a caller-side regeneration prompt can
 * quote the exact offending span back to its content generator." `stage` is
 * the stage's own identifying name (see `STAGE_NAMES` in `lint.ts`), never a
 * hardcoded literal at each call site.
 */
export interface LintFinding {
  readonly stage: string;
  readonly severity: "block";
  readonly message: string;
  readonly span?: { readonly start: number; readonly end: number };
}

/**
 * `LintOutcome` — roadmap/17 §Interfaces produced, verbatim union shape.
 */
export type LintOutcome =
  { readonly ok: true } | { readonly ok: false; readonly findings: readonly LintFinding[] };

/**
 * Shared input every stage function receives. Stages are pure, synchronous,
 * and read-only over this input — no stage mutates `candidate` or `policy`.
 */
export interface LintStageInput {
  readonly candidate: string;
  readonly kind: ArtifactKind;
  readonly policy: CommunicationPolicy;
}

/** A single ordered pipeline stage: pure function from input to zero or more findings. */
export type LintStage = (input: LintStageInput) => readonly LintFinding[];
