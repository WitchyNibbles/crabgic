import { DIFF_PATH_RISK_PATTERNS, type PerformanceRiskCategory } from "./categories.js";

/**
 * One diff path's own matched categories, plus the pattern-matching
 * rationale — kept per-path (rather than immediately collapsed into a
 * single `Set`) so `./detector.ts` can attribute a category back to the
 * path(s) that triggered it.
 */
export interface DiffPathRiskMatch {
  readonly path: string;
  readonly categories: readonly PerformanceRiskCategory[];
}

/** Classifies one changed path against every pattern in `DIFF_PATH_RISK_PATTERNS`; a path may match zero, one, or several categories. */
export function classifyDiffPath(path: string): readonly PerformanceRiskCategory[] {
  const matched: PerformanceRiskCategory[] = [];
  for (const [category, patterns] of DIFF_PATH_RISK_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(path))) {
      matched.push(category);
    }
  }
  return matched;
}

/** Classifies every path in a diff, returning one `DiffPathRiskMatch` per path (including paths matching zero categories, for full traceability). */
export function classifyDiffPaths(paths: readonly string[]): readonly DiffPathRiskMatch[] {
  return paths.map((path) => ({ path, categories: classifyDiffPath(path) }));
}

/** The union of every category matched across an entire diff's paths, as a `Set` — the form `./detector.ts` composes with `StackEvidence`-derived categories. */
export function unionDiffPathRiskCategories(
  paths: readonly string[],
): ReadonlySet<PerformanceRiskCategory> {
  const union = new Set<PerformanceRiskCategory>();
  for (const match of classifyDiffPaths(paths)) {
    for (const category of match.categories) {
      union.add(category);
    }
  }
  return union;
}
