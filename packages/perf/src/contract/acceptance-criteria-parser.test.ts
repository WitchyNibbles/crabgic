import { describe, expect, it } from "vitest";
import {
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

  it("accepts >, >=, < operators too (direction is carried by the metric, not the operator)", () => {
    expect(parseAcceptanceCriterionAsBudget("throughput >= 1000 ops/sec")).toEqual({
      metric: "throughput",
      threshold: 1000,
      unit: "ops/sec",
    });
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
