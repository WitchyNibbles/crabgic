import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema } from "../shared/ids.js";
import type { DesignRecord } from "./design-record.js";

/**
 * `PlanRecord` — the plan stage's artifact, as data.
 *
 * WHY THIS EXISTS. `plan-dependencies-acyclic` — "task dependencies form a directed
 * acyclic graph, so the plan can actually be executed in some order" — was filed as
 * a criterion "a reviewer checks". It is a graph algorithm. It has always been a
 * graph algorithm. Interface-ledger Gap 20 grouped it with the genuine judgements
 * because all of them shared one property: the plan lived in narrative prose, so
 * none of them had anything to run against.
 *
 * That is the whole content of the "judged criteria are undecidable" limit for three
 * of this stage's criteria. Not that the questions are subjective — that the
 * artifact was not data.
 *
 * The same boundary applies as for `DesignRecord`: this decides CLAIMED coverage,
 * never ADEQUATE coverage. A `doneCriteria` entry can read "it works". Structure
 * removes the omission failure, not the quality one, and the quality half stays
 * judged and attested.
 */

export const PlanTaskSchema = z
  .object({
    id: NonEmptyStringSchema,
    statement: NonEmptyStringSchema,
    /**
     * How it will be known to be done, "in terms something other than the author
     * can check".
     *
     * A list rather than a string because a task usually has more than one, and
     * because an empty list is then the natural representation of the state the
     * criterion excludes.
     */
    doneCriteria: z.array(NonEmptyStringSchema).default([]),
    /** Task ids this one depends on. The edges of the graph. */
    dependsOn: z.array(NonEmptyStringSchema).default([]),
    /** `DesignElement` ids this task implements — the coverage mapping. */
    covers: z.array(NonEmptyStringSchema).default([]),
  })
  .strict();

export const PlanRecordSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    changeSetId: IdSchema,
    tasks: z.array(PlanTaskSchema).default([]),
  })
  .strict();

export type PlanTask = z.infer<typeof PlanTaskSchema>;
export type PlanRecord = z.infer<typeof PlanRecordSchema>;

export const PLAN_DONE_CRITERIA_CRITERION = "plan-tasks-have-done-criteria";
export const PLAN_ACYCLIC_CRITERION = "plan-dependencies-acyclic";
export const PLAN_COVERAGE_CRITERION = "plan-covers-every-design-element";

/** A dependency naming a task that does not exist is not an edge; it is a typo. */
export function danglingDependencies(record: PlanRecord): readonly string[] {
  const ids = new Set(record.tasks.map((task) => task.id));
  const dangling = new Set<string>();
  for (const task of record.tasks) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) dangling.add(dependency);
    }
  }
  return [...dangling];
}

/**
 * Is the dependency graph acyclic?
 *
 * Iterative depth-first search with an explicit stack, not recursion: a plan is
 * caller-supplied data and a deep chain would blow the call stack, turning a
 * criterion check into a crash. `visiting` is the DFS colour that detects a back
 * edge; `visited` stops re-walking a shared subtree, which is what keeps a wide
 * diamond-shaped plan from going exponential.
 *
 * A dangling dependency is NOT treated as a cycle — it is reported separately by
 * `danglingDependencies`. Collapsing the two would tell a caller to look for a loop
 * that does not exist.
 */
export function isAcyclic(record: PlanRecord): boolean {
  const edges = new Map(record.tasks.map((task) => [task.id, task.dependsOn]));
  const visited = new Set<string>();
  const visiting = new Set<string>();

  for (const task of record.tasks) {
    if (visited.has(task.id)) continue;
    // Each frame is a node plus how many of its edges have been walked, which is
    // what lets the loop pop `visiting` at exactly the right moment.
    const stack: { readonly node: string; index: number }[] = [{ node: task.id, index: 0 }];
    visiting.add(task.id);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const children = edges.get(frame.node) ?? [];
      if (frame.index >= children.length) {
        visiting.delete(frame.node);
        visited.add(frame.node);
        stack.pop();
        continue;
      }
      const child = children[frame.index]!;
      frame.index += 1;
      if (!edges.has(child)) continue; // dangling — reported elsewhere, not a cycle
      if (visiting.has(child)) return false;
      if (visited.has(child)) continue;
      visiting.add(child);
      stack.push({ node: child, index: 0 });
    }
  }
  return true;
}

/** `DesignElement` ids no task claims to implement. */
export function uncoveredDesignElements(
  plan: PlanRecord,
  design: DesignRecord,
): readonly string[] {
  const covered = new Set(plan.tasks.flatMap((task) => task.covers));
  return design.elements.filter((element) => !covered.has(element.id)).map((element) => element.id);
}

/**
 * The plan-stage criteria the RECORD decides.
 *
 * An empty task list decides nothing, in both directions — a plan with no tasks has
 * not shown its dependencies are acyclic, it has shown that nobody wrote any tasks
 * down, and `[].every(...)` closing a stage is the vacuous closure this repository
 * refuses everywhere else.
 *
 * `plan-covers-every-design-element` derives only when the design record is
 * available, because the reference set is the DESIGN's elements. Taking it from the
 * plan's own `covers` fields would ask the plan whether it covers what it says it
 * covers, which is always yes.
 */
export function derivePlanCriteria(
  record: PlanRecord,
  design?: DesignRecord,
): readonly string[] {
  const derived: string[] = [];
  if (record.tasks.length === 0) return derived;

  if (record.tasks.every((task) => task.doneCriteria.length > 0)) {
    derived.push(PLAN_DONE_CRITERIA_CRITERION);
  }
  if (danglingDependencies(record).length === 0 && isAcyclic(record)) {
    derived.push(PLAN_ACYCLIC_CRITERION);
  }
  if (
    design !== undefined &&
    design.elements.length > 0 &&
    uncoveredDesignElements(record, design).length === 0
  ) {
    derived.push(PLAN_COVERAGE_CRITERION);
  }
  return derived;
}

/**
 * Criteria the record actively CONTRADICTS — see `designContradictions` for why
 * this is separate from "not derived".
 *
 * Absence and violation are different states. A plan with no tasks recorded has
 * proven nothing and refuted nothing; a plan with a task that states no
 * done-criteria is evidence AGAINST that criterion, and an attestation claiming it
 * is met is contradicted by the artifact it describes.
 */
export function planContradictions(record: PlanRecord, design?: DesignRecord): readonly string[] {
  const contradicted: string[] = [];
  if (record.tasks.some((task) => task.doneCriteria.length === 0)) {
    contradicted.push(PLAN_DONE_CRITERIA_CRITERION);
  }
  if (record.tasks.length > 0 && (danglingDependencies(record).length > 0 || !isAcyclic(record))) {
    contradicted.push(PLAN_ACYCLIC_CRITERION);
  }
  if (design !== undefined && uncoveredDesignElements(record, design).length > 0) {
    contradicted.push(PLAN_COVERAGE_CRITERION);
  }
  return contradicted;
}
