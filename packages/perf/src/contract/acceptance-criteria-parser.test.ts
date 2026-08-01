import { describe, expect, it } from "vitest";
import {
  ContradictoryCriterionDirectionError,
  parseAcceptanceCriteriaAsBudgets,
  parseAcceptanceCriterionAsBudget,
} from "./acceptance-criteria-parser.js";

describe("parseAcceptanceCriterionAsBudget", () => {
  it("parses a percentile latency criterion", () => {
    expect(parseAcceptanceCriterionAsBudget("latency p95 <= 200ms")).toEqual({
      metric: "latency",
      percentile: 95,
      threshold: 200,
      unit: "ms",
    });
  });

  it("parses a criterion with no percentile", () => {
    expect(parseAcceptanceCriterionAsBudget("cpu_time <= 5s")).toEqual({
      metric: "cpu_time",
      threshold: 5,
      unit: "s",
    });
  });

  it("parses a criterion with no unit as 'unitless'", () => {
    expect(parseAcceptanceCriterionAsBudget("query_count <= 10")).toEqual({
      metric: "query_count",
      threshold: 10,
      unit: "unitless",
    });
  });

  // PIN FLIPPED 2026-08-01 (ledger Gap 21, residual 2). This test used to be
  // titled "accepts >, >=, < operators too (direction is carried by the metric,
  // not the operator)" and asserted that `throughput >= 1000 ops/sec` parses —
  // true, but it pinned the WRONG general claim. The operator was captured by
  // the regex and then dropped through an array hole, so a criterion whose
  // operator CONTRADICTS its metric's canonical direction was silently
  // reinterpreted: `throughput <= 1000` (an author writing a cap) became a
  // floor at gate time, because `ProvisionalPerformanceBudgetEntry` has no
  // direction slot and `higherIsWorse` supplies it from the metric alone.
  //
  // The operator is now read for VALIDATION only — the schema is unchanged and
  // still carries no direction field. Direction-consistent operators parse
  // exactly as before (no derived budget value moves); a contradiction is
  // refused with a diagnostic instead of being reinterpreted.
  it("accepts an operator consistent with the metric's canonical direction", () => {
    // throughput/capacity are the two metrics where LOWER is worse: a budget is
    // a floor, so `>=`/`>` is the consistent operator.
    expect(parseAcceptanceCriterionAsBudget("throughput >= 1000 ops/sec")).toEqual({
      metric: "throughput",
      threshold: 1000,
      unit: "ops/sec",
    });
    expect(parseAcceptanceCriterionAsBudget("capacity > 50")).toEqual({
      metric: "capacity",
      threshold: 50,
      unit: "unitless",
    });
    // Every other metric is worse when it goes up: a budget is a cap.
    expect(parseAcceptanceCriterionAsBudget("latency < 200ms")).toEqual({
      metric: "latency",
      threshold: 200,
      unit: "ms",
    });
  });

  it.each([
    ["throughput <= 1000 ops/sec", "throughput"],
    ["throughput < 1000 ops/sec", "throughput"],
    ["capacity <= 50", "capacity"],
    ["latency p95 >= 200ms", "latency"],
    ["cpu_time > 5s", "cpu_time"],
    ["error_rate >= 0.01", "error_rate"],
  ])("rejects %j: its operator contradicts %s's canonical direction", (criterion, metric) => {
    expect(() => parseAcceptanceCriterionAsBudget(criterion)).toThrow(
      ContradictoryCriterionDirectionError,
    );
    expect(() => parseAcceptanceCriterionAsBudget(criterion)).toThrow(new RegExp(metric));
  });

  it("the rejection names the operator the author should have written", () => {
    expect(() => parseAcceptanceCriterionAsBudget("throughput <= 1000 ops/sec")).toThrow(/>=/);
    expect(() => parseAcceptanceCriterionAsBudget("latency >= 200ms")).toThrow(/<=/);
  });

  it("a contradiction is refused, never silently dropped to the next budget source", () => {
    // Dropping would be the same silent-degrade defect wearing a different hat:
    // the author's criterion vanishes and an ecosystem default takes its place.
    expect(() => parseAcceptanceCriteriaAsBudgets(["throughput <= 1000 ops/sec"])).toThrow(
      ContradictoryCriterionDirectionError,
    );
  });

  it("direction validation only applies to criteria that parse at all — prose is still prose", () => {
    expect(
      parseAcceptanceCriterionAsBudget("Throughput should not exceed 1000 requests."),
    ).toBeUndefined();
    // An unrecognized metric is not parseable, so there is no direction to
    // contradict — still `undefined`, never a throw.
    expect(parseAcceptanceCriterionAsBudget("vibes >= 5")).toBeUndefined();
  });

  it("returns undefined for pure prose", () => {
    expect(
      parseAcceptanceCriterionAsBudget("The checkout flow must feel snappy to users."),
    ).toBeUndefined();
  });

  it("returns undefined for an unrecognized metric name", () => {
    expect(parseAcceptanceCriterionAsBudget("vibes <= 5")).toBeUndefined();
  });

  it("returns undefined for an out-of-range percentile", () => {
    expect(parseAcceptanceCriterionAsBudget("latency p150 <= 200ms")).toBeUndefined();
  });
});

describe("parseAcceptanceCriteriaAsBudgets", () => {
  it("silently drops unparseable entries and keeps parseable ones", () => {
    const budgets = parseAcceptanceCriteriaAsBudgets([
      "latency p95 <= 200ms",
      "Users should feel the app is fast.",
      "cpu_time <= 5s",
    ]);
    expect(budgets).toHaveLength(2);
    expect(budgets[0]?.metric).toBe("latency");
    expect(budgets[1]?.metric).toBe("cpu_time");
  });

  it("an all-prose acceptance criteria list yields an empty budget set", () => {
    expect(parseAcceptanceCriteriaAsBudgets(["Looks nice.", "Works on mobile."])).toEqual([]);
  });
});
