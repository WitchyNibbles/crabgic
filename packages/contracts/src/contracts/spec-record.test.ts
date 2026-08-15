import { describe, expect, it } from "vitest";
import {
  SPEC_ACCEPTANCE_VERBATIM_CRITERION,
  SPEC_DONE_CRITERIA_CRITERION,
  SpecRecordSchema,
  deriveSpecCriteria,
  specContradictions,
  unresolvableRequirementIds,
  type SpecRecord,
} from "./spec-record.js";

/**
 * `SpecRecord` — the spec-driven-development unit, roadmap/25 work item 3.
 *
 * WHAT IT FIXES. A `PlanRecord` task says what to do and how it will be known
 * done. The worker that has to satisfy the acceptance criteria has never seen
 * them: `TaskPacket` carries `requirementIds` only, and a worker in a sandboxed
 * worktree cannot resolve a registry. So the party doing the work is the one
 * party without the criteria — which is the omission this record closes.
 */

const spec = (overrides: Partial<SpecRecord> = {}): SpecRecord =>
  SpecRecordSchema.parse({
    schemaVersion: 1,
    id: "11111111-2222-4333-8444-555555555555",
    taskId: "task-1",
    requirements: [
      {
        requirementId: "req-1",
        acceptanceCriteria: ["The command exits non-zero when the config file is absent."],
      },
    ],
    doneCriteria: ["`crabgic doctor` reports the missing-config case with exit code 2."],
    testsFirst: true,
    permittedInterfaces: [],
    ...overrides,
  });

describe("SpecRecordSchema", () => {
  it("parses a spec that carries its acceptance criteria", () => {
    expect(() => spec()).not.toThrow();
  });

  it("refuses a requirement whose acceptance criteria are absent", () => {
    // A requirement reference with no criteria is the state this record exists
    // to remove -- it is `requirementIds` again, wearing a longer name.
    expect(
      SpecRecordSchema.safeParse({
        schemaVersion: 1,
        id: "11111111-2222-4333-8444-555555555555",
        taskId: "task-1",
        requirements: [{ requirementId: "req-1", acceptanceCriteria: [] }],
        doneCriteria: ["something checkable"],
        testsFirst: true,
        permittedInterfaces: [],
      }).success,
    ).toBe(false);
  });

  it("refuses an empty acceptance criterion string", () => {
    // A present-but-blank criterion satisfies a length check on the array while
    // telling the worker nothing. Both shapes have to be unrepresentable or the
    // record only appears to carry the criteria.
    expect(
      SpecRecordSchema.safeParse({
        schemaVersion: 1,
        id: "11111111-2222-4333-8444-555555555555",
        taskId: "task-1",
        requirements: [{ requirementId: "req-1", acceptanceCriteria: [""] }],
        doneCriteria: ["something checkable"],
        testsFirst: true,
        permittedInterfaces: [],
      }).success,
    ).toBe(false);
  });

  it("refuses a spec that opts out of tests-first", () => {
    // The repository's first ground rule is TDD, without exception. A boolean
    // that can be `false` is an exception mechanism, so the schema pins the
    // literal -- the obligation is not a setting.
    expect(SpecRecordSchema.safeParse({ ...spec(), testsFirst: false }).success).toBe(false);
  });
});

describe("deriveSpecCriteria", () => {
  it("derives the verbatim-acceptance criterion when every requirement carries criteria", () => {
    expect(deriveSpecCriteria(spec())).toContain(SPEC_ACCEPTANCE_VERBATIM_CRITERION);
  });

  it("does NOT derive it from an empty requirement list", () => {
    // The vacuity rule, for the fourth time in this package: `[].every(...)` is
    // `true`, so a spec serving no requirement would otherwise prove that every
    // requirement it serves is covered.
    expect(deriveSpecCriteria(spec({ requirements: [] }))).not.toContain(
      SPEC_ACCEPTANCE_VERBATIM_CRITERION,
    );
  });

  it("derives the done-criteria criterion when the task states how it is checked", () => {
    expect(deriveSpecCriteria(spec())).toContain(SPEC_DONE_CRITERIA_CRITERION);
  });

  it("does NOT derive it when the task states no done-criteria", () => {
    expect(deriveSpecCriteria(spec({ doneCriteria: [] }))).not.toContain(
      SPEC_DONE_CRITERIA_CRITERION,
    );
  });
});

describe("unresolvableRequirementIds", () => {
  it("names a requirement the spec claims that the registry does not hold", () => {
    // Phase 24's ruling: an unresolvable declared id means the run's acceptance
    // basis is incoherent. It is an integrity failure of the INPUTS, so it is
    // reported by id rather than folded into a per-task verdict.
    expect(unresolvableRequirementIds(spec(), ["req-other"])).toEqual(["req-1"]);
  });

  it("names nothing when every claimed requirement resolves", () => {
    expect(unresolvableRequirementIds(spec(), ["req-1"])).toEqual([]);
  });

  it("reports a PARTIAL set by naming only the missing ids", () => {
    // Refusing wholesale would tell an operator to go looking through every
    // requirement; naming the missing ones is the difference between a refusal
    // and a diagnosis.
    const two = spec({
      requirements: [
        { requirementId: "req-1", acceptanceCriteria: ["a"] },
        { requirementId: "req-2", acceptanceCriteria: ["b"] },
      ],
    });
    expect(unresolvableRequirementIds(two, ["req-1"])).toEqual(["req-2"]);
  });
});

describe("specContradictions", () => {
  it("contradicts the verbatim criterion when a requirement duplicates another", () => {
    // Two entries for one requirement id mean two different criteria sets could
    // both claim to be what the worker must satisfy, and nothing chooses. That
    // is evidence against the criterion rather than silence about it.
    const duplicated = spec({
      requirements: [
        { requirementId: "req-1", acceptanceCriteria: ["a"] },
        { requirementId: "req-1", acceptanceCriteria: ["b"] },
      ],
    });
    expect(specContradictions(duplicated)).toContain(SPEC_ACCEPTANCE_VERBATIM_CRITERION);
  });

  it("reports nothing for a spec that is merely empty", () => {
    expect(specContradictions(spec({ requirements: [] }))).toEqual([]);
  });

  it("reports nothing for a well-formed spec", () => {
    expect(specContradictions(spec())).toEqual([]);
  });
});
