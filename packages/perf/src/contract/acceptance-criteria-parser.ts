import {
  PERFORMANCE_METRICS,
  PerformanceMetricSchema,
  type ProvisionalPerformanceBudgetEntry,
} from "@eo/contracts";

/**
 * Free-text `Requirement.acceptanceCriteria` parser — roadmap/15 §In scope,
 * "Budget sourcing" bullet, source #1: "The ChangeSet's IntentContract
 * `performance` section / Requirement acceptance criteria." `Requirement`
 * (02)'s own doc comment states "no structured acceptance-criterion format
 * is pinned upstream" — so this phase documents its own minimal-sufficient
 * parsing convention: a criterion of the shape
 * `<metric> [p<percentile>] <op> <threshold> [unit]`, e.g.
 * `"latency p95 <= 200ms"` or `"cpu_time <= 5s"`. A criterion that doesn't
 * match this shape is simply not parseable as a budget (falls through to
 * the next budget source for that metric) — never a thrown error, since
 * plenty of legitimate acceptance criteria are pure prose with no
 * performance-budget content at all.
 */
const CRITERION_PATTERN =
  /^\s*([a-z_]+)\s*(?:p(\d{1,2}))?\s*(<=|<|>=|>)\s*([\d.]+)\s*([a-zA-Z/%]+)?\s*$/;

const METRIC_SET = new Set<string>(PERFORMANCE_METRICS);

/** Parses one free-text acceptance-criterion string into a budget entry, or `undefined` if it doesn't match this module's documented shape. */
export function parseAcceptanceCriterionAsBudget(
  criterion: string,
): ProvisionalPerformanceBudgetEntry | undefined {
  const match = CRITERION_PATTERN.exec(criterion);
  if (match === null) return undefined;

  const [, rawMetric, rawPercentile, , rawThreshold, rawUnit] = match;
  if (rawMetric === undefined || rawThreshold === undefined) return undefined;
  if (!METRIC_SET.has(rawMetric)) return undefined;

  const metricResult = PerformanceMetricSchema.safeParse(rawMetric);
  if (!metricResult.success) return undefined;

  const threshold = Number(rawThreshold);
  if (!Number.isFinite(threshold)) return undefined;

  const percentile = rawPercentile !== undefined ? Number(rawPercentile) : undefined;
  if (percentile !== undefined && (percentile < 1 || percentile > 99)) return undefined;

  return {
    metric: metricResult.data,
    ...(percentile !== undefined ? { percentile } : {}),
    threshold,
    unit: rawUnit ?? "unitless",
  };
}

/** Parses every criterion in a `Requirement`'s `acceptanceCriteria` list, silently dropping unparseable entries (pure prose). */
export function parseAcceptanceCriteriaAsBudgets(
  acceptanceCriteria: readonly string[],
): readonly ProvisionalPerformanceBudgetEntry[] {
  const budgets: ProvisionalPerformanceBudgetEntry[] = [];
  for (const criterion of acceptanceCriteria) {
    const parsed = parseAcceptanceCriterionAsBudget(criterion);
    if (parsed !== undefined) budgets.push(parsed);
  }
  return budgets;
}
