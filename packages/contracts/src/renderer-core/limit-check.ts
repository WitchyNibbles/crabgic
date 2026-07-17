import { countChars } from "./length-counter.js";
import { countLines } from "./line-counter.js";

/**
 * `renderer-core` — limit-check primitive (roadmap/02 In-scope
 * "`renderer-core` module" bullet, Work item 6). A single boolean
 * predicate over `countChars`/`countLines`, deliberately NOT a lint
 * pipeline: no findings, no spans, no stage ordering, no regeneration.
 * Phase 17 owns the full `lint()`/`renderWithRegeneration()` pipeline
 * built on top of this predicate and the two counters (its own
 * `LintFinding`/`LintOutcome` types carry the richer per-violation detail);
 * this module stays primitive-level so 17 — and 08's belt-and-suspenders
 * assertion — can compose it without inheriting pipeline behavior they
 * don't want, and so this phase's own boundary tests (72/73-char commit
 * subject, 6/7-line review comment — roadmap/02 Test plan) have something
 * concrete to exercise before 17 exists.
 */

/**
 * Either bound may be omitted; an omitted bound is not checked. Shaped to
 * accept a `{ maxChars, maxLines }`-bearing slice of
 * `COMMUNICATION_POLICY_LIMITS` (`../contracts/communication-policy.js`)
 * directly, without adapting field names — every limit object in that
 * module that carries `maxChars` and/or `maxLines` structurally satisfies
 * this interface even though it may carry additional fields (e.g.
 * `format`, `sections`) that `checkLimit` ignores.
 */
export interface LengthLimit {
  readonly maxChars?: number;
  readonly maxLines?: number;
}

/**
 * `true` iff `text` is within every bound present on `limit`. Pure — reads
 * only its arguments, mutates nothing, throws nothing.
 */
export function checkLimit(text: string, limit: LengthLimit): boolean {
  if (limit.maxChars !== undefined && countChars(text) > limit.maxChars) {
    return false;
  }
  if (limit.maxLines !== undefined && countLines(text) > limit.maxLines) {
    return false;
  }
  return true;
}
