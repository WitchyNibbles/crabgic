import { describe, expect, it } from "vitest";
import {
  PLAN_ACYCLIC_CRITERION,
  PLAN_COVERAGE_CRITERION,
  PLAN_DONE_CRITERIA_CRITERION,
  PlanRecordSchema,
  danglingDependencies,
  derivePlanCriteria,
  isAcyclic,
  planContradictions,
  type PlanRecord,
} from "./plan-record.js";
import { DesignRecordSchema, type DesignRecord } from "./design-record.js";

/**
 * `plan-dependencies-acyclic` — "task dependencies form a directed acyclic graph,
 * so the plan can actually be executed in some order" — was filed as a criterion a
 * reviewer checks. It is a graph algorithm, and always was. What made it look
 * subjective is that the plan lived in narrative prose, so there was nothing to run
 * it against.
 */

const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";

function plan(tasks: Record<string, unknown>[]): PlanRecord {
  return PlanRecordSchema.parse({ schemaVersion: 1, changeSetId: CHANGE_SET_ID, tasks });
}

function task(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    statement: `do ${id}`,
    doneCriteria: [`a test named ${id} passes`],
    dependsOn: [],
    covers: [],
    ...overrides,
  };
}

function design(elementIds: string[]): DesignRecord {
  return DesignRecordSchema.parse({
    schemaVersion: 1,
    changeSetId: CHANGE_SET_ID,
    elements: elementIds.map((id) => ({ id, name: `element ${id}`, addresses: [] })),
  });
}

describe("isAcyclic", () => {
  it("accepts a chain", () => {
    expect(isAcyclic(plan([task("a"), task("b", { dependsOn: ["a"] })]))).toBe(true);
  });

  it("accepts a diamond, where two tasks share a dependency", () => {
    // Also the case that would go exponential without the `visited` set.
    expect(
      isAcyclic(
        plan([
          task("a"),
          task("b", { dependsOn: ["a"] }),
          task("c", { dependsOn: ["a"] }),
          task("d", { dependsOn: ["b", "c"] }),
        ]),
      ),
    ).toBe(true);
  });

  it("rejects a two-task cycle", () => {
    expect(isAcyclic(plan([task("a", { dependsOn: ["b"] }), task("b", { dependsOn: ["a"] })]))).toBe(
      false,
    );
  });

  it("rejects a longer cycle", () => {
    expect(
      isAcyclic(
        plan([
          task("a", { dependsOn: ["c"] }),
          task("b", { dependsOn: ["a"] }),
          task("c", { dependsOn: ["b"] }),
        ]),
      ),
    ).toBe(false);
  });

  it("rejects a task that depends on itself", () => {
    expect(isAcyclic(plan([task("a", { dependsOn: ["a"] })]))).toBe(false);
  });

  /** A deep chain must not blow the call stack — a caller-supplied plan is data. */
  it("handles a chain far deeper than the call stack would allow recursion", () => {
    const tasks = Array.from({ length: 20_000 }, (_unused, index) =>
      task(`t${String(index)}`, index === 0 ? {} : { dependsOn: [`t${String(index - 1)}`] }),
    );
    expect(isAcyclic(plan(tasks))).toBe(true);
  });

  it("does not treat a dangling dependency as a cycle", () => {
    const record = plan([task("a", { dependsOn: ["nope"] })]);
    expect(isAcyclic(record)).toBe(true);
    expect(danglingDependencies(record)).toEqual(["nope"]);
  });
});

describe("derivePlanCriteria", () => {
  it("derives done-criteria and acyclicity from a well-formed plan", () => {
    const derived = derivePlanCriteria(plan([task("a"), task("b", { dependsOn: ["a"] })]));
    expect(derived).toContain(PLAN_DONE_CRITERIA_CRITERION);
    expect(derived).toContain(PLAN_ACYCLIC_CRITERION);
  });

  it("withholds done-criteria when any task states none", () => {
    const record = plan([task("a"), task("b", { doneCriteria: [] })]);
    expect(derivePlanCriteria(record)).not.toContain(PLAN_DONE_CRITERIA_CRITERION);
    expect(planContradictions(record)).toContain(PLAN_DONE_CRITERIA_CRITERION);
  });

  it("withholds acyclicity for a cycle, and reports the contradiction", () => {
    const record = plan([task("a", { dependsOn: ["b"] }), task("b", { dependsOn: ["a"] })]);
    expect(derivePlanCriteria(record)).not.toContain(PLAN_ACYCLIC_CRITERION);
    expect(planContradictions(record)).toContain(PLAN_ACYCLIC_CRITERION);
  });

  it("withholds acyclicity for a dependency naming no task", () => {
    // Executable-in-some-order is the point of the criterion, and a plan waiting on
    // a task that does not exist is not executable in any order.
    const record = plan([task("a", { dependsOn: ["ghost"] })]);
    expect(derivePlanCriteria(record)).not.toContain(PLAN_ACYCLIC_CRITERION);
    expect(planContradictions(record)).toContain(PLAN_ACYCLIC_CRITERION);
  });

  /**
   * The property that keeps this honest. `[].every(...)` is `true`, so an empty plan
   * would satisfy every criterion vacuously — the same failure `exitCriteriaFor`
   * refuses for an unknown stage and `deriveGateCriteria` refuses for an empty
   * evidence set. A plan with no tasks has not shown its dependencies are acyclic;
   * it has shown that nobody wrote any tasks down.
   */
  it("derives NOTHING from an empty plan, rather than everything", () => {
    expect(derivePlanCriteria(plan([]))).toEqual([]);
  });

  /** Nor does an empty plan CONTRADICT anything — absence is not violation. */
  it("contradicts nothing on an empty plan", () => {
    expect(planContradictions(plan([]))).toEqual([]);
  });

  describe("coverage of the design", () => {
    it("derives coverage when every design element is claimed by some task", () => {
      const record = plan([task("a", { covers: ["e1"] }), task("b", { covers: ["e2"] })]);
      expect(derivePlanCriteria(record, design(["e1", "e2"]))).toContain(PLAN_COVERAGE_CRITERION);
    });

    it("withholds coverage when a design element is claimed by nothing", () => {
      const record = plan([task("a", { covers: ["e1"] })]);
      expect(derivePlanCriteria(record, design(["e1", "e2"]))).not.toContain(
        PLAN_COVERAGE_CRITERION,
      );
      expect(planContradictions(record, design(["e1", "e2"]))).toContain(PLAN_COVERAGE_CRITERION);
    });

    /**
     * The reference set is the DESIGN's elements, never the plan's own `covers`
     * fields. Asking the plan whether it covers what it says it covers always
     * answers yes.
     */
    it("does not derive coverage with no design record to compare against", () => {
      const record = plan([task("a", { covers: ["e1", "e2", "e3"] })]);
      expect(derivePlanCriteria(record)).not.toContain(PLAN_COVERAGE_CRITERION);
    });

    it("does not derive coverage against a design that records no elements", () => {
      expect(derivePlanCriteria(plan([task("a")]), design([]))).not.toContain(
        PLAN_COVERAGE_CRITERION,
      );
    });
  });
});

describe("PlanRecordSchema", () => {
  it("rejects an unknown key (.strict())", () => {
    expect(
      PlanRecordSchema.safeParse({
        schemaVersion: 1,
        changeSetId: CHANGE_SET_ID,
        tasks: [],
        estimate: "2 weeks",
      }).success,
    ).toBe(false);
  });

  it("rejects an empty done-criterion string, which is the same as none", () => {
    expect(
      PlanRecordSchema.safeParse({
        schemaVersion: 1,
        changeSetId: CHANGE_SET_ID,
        tasks: [task("a", { doneCriteria: [""] })],
      }).success,
    ).toBe(false);
  });
});
