import { higherIsWorse } from "./metric-direction.js";
import {
  PERFORMANCE_METRICS,
  PerformanceMetricSchema,
  type PerformanceMetric,
  type ProvisionalPerformanceBudgetEntry,
} from "./performance-contract.js";

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

/** The comparison operators `CRITERION_PATTERN` recognizes. `<=`/`<` state a CAP, `>=`/`>` a FLOOR. */
type CriterionOperator = "<=" | "<" | ">=" | ">";

function statesACap(operator: CriterionOperator): boolean {
  return operator === "<=" || operator === "<";
}

/**
 * A criterion parses cleanly but its comparison operator states the opposite
 * of what the metric's canonical direction means (ledger Gap 21, residual 2).
 *
 * WHY THIS IS AN ERROR RATHER THAN A DROP OR A SHRUG.
 * `ProvisionalPerformanceBudgetEntry` is `.strict()` and carries `metric`,
 * `threshold` and `unit` — no direction slot. Phase 15's gate recovers the
 * direction from the metric alone (`./metric-direction.ts`, total over the
 * closed 13-member enum), so the operator has nowhere to live. The parser used
 * to capture it and drop it through an array hole, which meant
 * `throughput <= 1000 ops/sec` — an author writing a CAP — was recorded as a
 * budget the gate then enforced as a FLOOR. Not a wrong-direction gate (the
 * direction is always the metric's own), but a silent reinterpretation of the
 * author's stated intent into its opposite.
 *
 * Dropping the criterion instead would just move the silence: the author's
 * budget would vanish and an ecosystem default or a base-revision measurement
 * would quietly take its place. The only honest outcome for a well-formed
 * statement this schema cannot represent is to refuse it and say why.
 */
export class ContradictoryCriterionDirectionError extends Error {
  constructor(
    readonly criterion: string,
    readonly metric: PerformanceMetric,
    readonly operator: CriterionOperator,
  ) {
    const isCapMetric = higherIsWorse(metric);
    const expected = isCapMetric ? "<= (or <)" : ">= (or >)";
    super(
      `acceptance criterion ${JSON.stringify(criterion)} states "${operator}", but a ` +
        `${metric} budget is a ${isCapMetric ? "cap" : "floor"}: ${metric} is worse when it goes ` +
        `${isCapMetric ? "higher" : "lower"}. A performance budget carries no direction of its own — ` +
        `the gate takes it from the metric — so this criterion cannot be represented as written. ` +
        `Write ${expected}, or state the bound you mean using a metric whose direction matches it.`,
    );
    this.name = "ContradictoryCriterionDirectionError";
  }
}

/**
 * Parses one free-text acceptance-criterion string into a budget entry, or
 * `undefined` if it doesn't match this module's documented shape.
 *
 * Throws `ContradictoryCriterionDirectionError` — and only that — for a
 * criterion that DOES match the shape and names a known metric, but whose
 * comparison operator contradicts that metric's canonical direction. Prose,
 * unknown metrics and out-of-range percentiles remain `undefined`, never a
 * throw: they carry no budget claim to contradict.
 */
export function parseAcceptanceCriterionAsBudget(
  criterion: string,
): ProvisionalPerformanceBudgetEntry | undefined {
  const match = CRITERION_PATTERN.exec(criterion);
  if (match === null) return undefined;

  const [, rawMetric, rawPercentile, rawOperator, rawThreshold, rawUnit] = match;
  if (rawMetric === undefined || rawThreshold === undefined) return undefined;
  if (!METRIC_SET.has(rawMetric)) return undefined;

  const metricResult = PerformanceMetricSchema.safeParse(rawMetric);
  if (!metricResult.success) return undefined;

  const threshold = Number(rawThreshold);
  if (!Number.isFinite(threshold)) return undefined;

  const percentile = rawPercentile !== undefined ? Number(rawPercentile) : undefined;
  if (percentile !== undefined && (percentile < 1 || percentile > 99)) return undefined;

  // The operator is read for VALIDATION only. It is deliberately not carried
  // into the returned entry: the schema has no direction field, and adding one
  // would fork the gate's single source of truth for direction. Every
  // direction-CONSISTENT criterion therefore produces the exact same entry it
  // produced before this check existed — no derived budget value moves.
  const operator = rawOperator as CriterionOperator;
  if (statesACap(operator) !== higherIsWorse(metricResult.data)) {
    throw new ContradictoryCriterionDirectionError(criterion, metricResult.data, operator);
  }

  return {
    metric: metricResult.data,
    ...(percentile !== undefined ? { percentile } : {}),
    threshold,
    unit: rawUnit ?? "unitless",
  };
}

/**
 * Parses every criterion in a `Requirement`'s `acceptanceCriteria` list,
 * silently dropping unparseable entries (pure prose).
 *
 * Propagates `ContradictoryCriterionDirectionError` from any single criterion:
 * one direction-contradicting criterion fails the whole list rather than being
 * quietly omitted from the budget set it was meant to define.
 */
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
