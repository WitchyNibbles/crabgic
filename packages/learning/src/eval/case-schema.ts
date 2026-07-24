import { createHash } from "node:crypto";
import { z } from "zod";
import { NonEmptyStringSchema } from "@eo/contracts";

/**
 * `EvalCase` — roadmap/22-learning-system.md §In scope, "Eval infra":
 * "provider-neutral local format (JSONL cases + expected judgments), dev +
 * held-out sets, contamination checks (case-hash overlap, provenance)."
 * `provenanceId` is the case's origin fingerprint (e.g. the observation/
 * reproducer id it was minted from) — the field contamination detection
 * compares for a SHARED-provenance overlap, distinct from a case-hash
 * (content) overlap.
 */
export const EvalCaseSchema = z
  .object({
    id: NonEmptyStringSchema,
    /** Free-form structured input the candidate lesson is graded against — provider-neutral, no engine-specific shape assumed. */
    input: z.record(z.string(), z.unknown()),
    /** The expected pass/fail judgment a correct grading run should produce. */
    expectedJudgment: z.boolean(),
    provenanceId: NonEmptyStringSchema,
    /** When present, this case's ground truth is graded against real `EvidenceRecord`(s) recorded for this `Requirement` id (14) rather than a bare structural comparison — roadmap/22 §In scope: "dev/held-out grading is executed against P14's gate framework and EvidenceRecords as ground truth." Matches `@eo/gates`'s `findEvidenceForRequirement(journal, requirementId)`. */
    groundTruthRequirementId: z.string().uuid().optional(),
  })
  .strict();

export type EvalCase = z.infer<typeof EvalCaseSchema>;

/**
 * Recursively rebuilds `value` with every plain object's own keys
 * lexicographically sorted, AT EVERY NESTING LEVEL — arrays keep their
 * element order (order is semantically meaningful for arrays; it is not
 * for object key order). Never mutates `value`.
 *
 * ADVERSARIAL-VALIDATION FIX (2026-07-24): the ORIGINAL `computeCaseHash`
 * called `JSON.stringify(input, Object.keys(input).sort())` — passing a
 * sorted TOP-LEVEL key list as `JSON.stringify`'s REPLACER argument.
 * `JSON.stringify` applies an array replacer as an ALLOWLIST at EVERY
 * nesting level, not just the top one — so any key inside a NESTED object
 * that didn't happen to also appear as a top-level key was silently
 * DROPPED from the serialized output. Two `EvalCase`s with
 * `input: {scenario: {step: "login"}}` and `input: {scenario: {step:
 * "logout"}}` both normalized to the literal string `{"scenario":{}}` and
 * therefore hashed IDENTICALLY — a genuine, silent contamination-detection
 * miss for any case whose distinguishing content lives below the top
 * level (which `EvalCase.input`'s own schema — arbitrary, unconstrained
 * nesting — never rules out). This function replaces that broken
 * allowlist-replacer trick with true recursive canonicalization: every
 * object's keys are sorted at every depth, and NOTHING is ever dropped.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const sortedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, nested]) => [key, canonicalize(nested)] as const);
    return Object.fromEntries(sortedEntries);
  }
  return value;
}

/**
 * Deterministic content-hash for a case — normalizes `input` via true
 * recursive key-sorted canonicalization (see `canonicalize` above) so two
 * structurally-identical cases (key order aside, AT ANY NESTING DEPTH)
 * hash identically, and two structurally-DIFFERENT cases (however deeply
 * nested the difference) always hash differently. Used by
 * `../eval/contamination.ts` for the "case-hash overlap" contamination
 * check (roadmap/22 §In scope).
 */
export function computeCaseHash(evalCase: Pick<EvalCase, "input" | "expectedJudgment">): string {
  const normalized = JSON.stringify(canonicalize(evalCase.input));
  return createHash("sha256")
    .update(normalized)
    .update(String(evalCase.expectedJudgment))
    .digest("hex");
}

/** Encodes a list of cases as JSONL (one compact JSON object per line, trailing newline) — the "provider-neutral local format" this phase's own eval infra reads/writes. */
export function encodeCasesJsonl(cases: readonly EvalCase[]): string {
  return cases.map((c) => JSON.stringify(EvalCaseSchema.parse(c))).join("\n") + "\n";
}

/** Decodes a JSONL blob back into validated `EvalCase[]`; blank lines are skipped. */
export function decodeCasesJsonl(content: string): readonly EvalCase[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => EvalCaseSchema.parse(JSON.parse(line)));
}
