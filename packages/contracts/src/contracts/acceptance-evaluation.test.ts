import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_EVIDENCE_PREFIXES,
  AcceptanceEvaluationRecordSchema,
  CommandInvocationTallySchema,
  describeObservations,
  isEvaluationEvidence,
  unevaluatedRequirements,
  type AcceptanceEvaluationRecord,
} from "./acceptance-evaluation.js";
import {
  COMMAND_EVIDENCE_CLASS,
  GRANTABLE_COMMAND_PREFIXES,
  classifyGrantedCommand,
} from "./envelope-policy.js";
import { RequirementSchema, type Requirement } from "./requirement.js";

const CHANGE_SET = "11111111-1111-4111-8111-111111111111";
const OTHER_CHANGE_SET = "22222222-2222-4222-8222-222222222222";
const UNIT = "33333333-3333-4333-8333-333333333333";
const REQ_A = "44444444-4444-4444-8444-444444444444";
const REQ_B = "55555555-5555-4555-8555-555555555555";
const UNIT_B = "77777777-7777-4777-8777-777777777778";
const SESSION_1 = "66666666-6666-4666-8666-666666666666";
const SESSION_2 = "66666666-6666-4666-8666-666666666667";

/** Built through the schema, never cast — a cast would let this suite assert against a shape the contract does not accept. */
function requirement(id: string, title: string): Requirement {
  return RequirementSchema.parse({
    schemaVersion: 1,
    id,
    intentContractId: "77777777-7777-4777-8777-777777777777",
    section: "scope",
    title,
    description: "d",
    acceptanceCriteria: [`${title} works`],
    criteriaHash: "sha256:fixture",
    workUnitIds: [],
    renderedArtifactIds: [],
    testIdentifiers: [],
    evidenceRecordIds: [],
    createdAt: "2026-08-16T00:00:00.000Z",
  });
}

function record(overrides: Partial<AcceptanceEvaluationRecord> = {}): AcceptanceEvaluationRecord {
  return {
    schemaVersion: 1,
    changeSetId: CHANGE_SET,
    workUnitId: UNIT,
    sessionId: SESSION_1,
    requirementIds: [REQ_A],
    invocations: [{ prefix: "npm run test", invocations: 1, cleanExits: 1 }],
    observedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("the grantable-command evidence classification", () => {
  /**
   * The exhaustiveness property, asserted structurally rather than trusted to
   * the `Record` literal alone. `tsc` already rejects a missing key, but this
   * test is what a reader of the SUITE sees, and it fails on a widened
   * vocabulary in a way that names the omission.
   */
  it("classifies every grantable prefix, and only those", () => {
    expect(Object.keys(COMMAND_EVIDENCE_CLASS).sort()).toStrictEqual(
      [...GRANTABLE_COMMAND_PREFIXES].sort(),
    );
  });

  /**
   * The load-bearing one. `bc167a3a` ran `npm run build` clean, said in its own
   * result record that the suite never ran, and published anyway — R5 exists to
   * refuse that run. If `npm run build` were ever classed `acceptance`, R5 would
   * pass the very run it was written for and this test is the only thing that
   * would say so.
   */
  it("counts only `npm run test` as acceptance evidence — a clean build is not a verified change set", () => {
    expect(ACCEPTANCE_EVIDENCE_PREFIXES).toStrictEqual(["npm run test"]);
    expect(COMMAND_EVIDENCE_CLASS["npm run build"]).toBe("integrity");
    expect(COMMAND_EVIDENCE_CLASS["git status"]).toBe("inspection");
    expect(COMMAND_EVIDENCE_CLASS["git diff"]).toBe("inspection");
  });

  it("classifies an invoked command by its longest matching grant, and refuses an ungranted one", () => {
    expect(classifyGrantedCommand("npm run test -- packages/gates")).toBe("npm run test");
    expect(classifyGrantedCommand("git status --short")).toBe("git status");
    // Not granted: the compiled profile could not have permitted it, so it is
    // evidence of nothing.
    expect(classifyGrantedCommand("npm run lint")).toBeUndefined();
    expect(classifyGrantedCommand("echo npm run test")).toBeUndefined();
  });
});

describe("AcceptanceEvaluationRecordSchema", () => {
  it("accepts a well-formed record and rejects an unknown member", () => {
    expect(() => AcceptanceEvaluationRecordSchema.parse(record())).not.toThrow();
    expect(() =>
      AcceptanceEvaluationRecordSchema.parse({ ...record(), verified: true }),
    ).toThrow();
  });

  /**
   * ⚠️ THE MEMBER LIST IS THE POINT, in the same way `StageCompletionRecord`'s
   * is. This record's value comes from being an OBSERVATION: nothing on it is a
   * conclusion a producer could assert. A `verified`/`passed`/`criteriaMet`
   * member would let a caller hand the gate the gate's own answer, which is a
   * slower way of trusting the caller.
   */
  it("carries no member a producer could use to assert that the criteria were met", () => {
    expect(Object.keys(AcceptanceEvaluationRecordSchema.shape).sort()).toStrictEqual([
      "changeSetId",
      "invocations",
      "observedAt",
      "requirementIds",
      "schemaVersion",
      "sessionId",
      "workUnitId",
    ]);
  });

  it("refuses more clean exits than invocations — a tally that claims a command succeeded more often than it ran", () => {
    expect(() =>
      CommandInvocationTallySchema.parse({ prefix: "npm run test", invocations: 1, cleanExits: 2 }),
    ).toThrow();
  });
});

describe("unevaluatedRequirements", () => {
  it("reports nothing unevaluated when an acceptance-class command ran clean for the requirement", () => {
    expect(unevaluatedRequirements([requirement(REQ_A, "A")], [record()], CHANGE_SET)).toStrictEqual(
      [],
    );
  });

  it("reports the requirement with its criteria when no record exists at all", () => {
    expect(unevaluatedRequirements([requirement(REQ_A, "A")], [], CHANGE_SET)).toStrictEqual([
      { requirementId: REQ_A, title: "A", acceptanceCriteria: ["A works"] },
    ]);
  });

  /**
   * The `bc167a3a` case, at the unit level: commands ran, none of them checked
   * anything.
   */
  it("reports the requirement when the only clean exits were integrity and inspection commands", () => {
    const buildOnly = record({
      invocations: [
        { prefix: "npm run build", invocations: 1, cleanExits: 1 },
        { prefix: "git diff", invocations: 4, cleanExits: 4 },
      ],
    });
    expect(unevaluatedRequirements([requirement(REQ_A, "A")], [buildOnly], CHANGE_SET)).toHaveLength(
      1,
    );
  });

  /**
   * The `04a0bf70` case: the worker tried and the command path was broken.
   * Twelve invocations, zero clean.
   */
  it("reports the requirement when the acceptance command was invoked repeatedly and never ran clean", () => {
    const allFailed = record({
      invocations: [{ prefix: "npm run test", invocations: 12, cleanExits: 0 }],
    });
    expect(unevaluatedRequirements([requirement(REQ_A, "A")], [allFailed], CHANGE_SET)).toHaveLength(
      1,
    );
  });

  /**
   * Without this, one change set's verification would open every later change
   * set's publish gate — the same cross-subject hole R8's stage-completion
   * reader closes.
   */
  it("ignores a record belonging to another change set", () => {
    const foreign = record({ changeSetId: OTHER_CHANGE_SET });
    expect(unevaluatedRequirements([requirement(REQ_A, "A")], [foreign], CHANGE_SET)).toHaveLength(
      1,
    );
  });

  it("ignores a record that covers a different requirement of the same change set", () => {
    const otherRequirement = record({ requirementIds: [REQ_B] });
    expect(
      unevaluatedRequirements([requirement(REQ_A, "A")], [otherRequirement], CHANGE_SET),
    ).toHaveLength(1);
  });

  /**
   * ⚠️ THE REPAIR HOLE, and the reason coverage is scoped to the latest session
   * rather than unioned across every attempt.
   *
   * Attempt one runs the suite clean and fails for some other reason. Attempt
   * two — a fresh engine session, against CHANGED code — rewrites the work, runs
   * only the build, and reports success. A plain union would publish that on
   * attempt one's verification of code that no longer exists.
   */
  it("does NOT credit a repair attempt with the verification of the attempt it replaced", () => {
    const firstAttempt = record({ sessionId: SESSION_1 });
    const repairWithoutTests = record({
      sessionId: SESSION_2,
      invocations: [{ prefix: "npm run build", invocations: 1, cleanExits: 1 }],
    });
    expect(
      unevaluatedRequirements([requirement(REQ_A, "A")], [firstAttempt, repairWithoutTests], CHANGE_SET),
    ).toHaveLength(1);
  });

  /**
   * The other side of that rule, and why it keys on SESSION and not on record
   * recency. A rate-limit park and its resume are the same engine session
   * (`EngineAdapter.resume` carries `sessionRef.sessionId` through), so a suite
   * that ran before the park still speaks for the code that shipped. Keying on
   * the latest RECORD would discard it and refuse every parked run.
   */
  it("unions segments WITHIN one session, so a park-resume does not discard the pre-park test run", () => {
    const beforePark = record({ sessionId: SESSION_1 });
    const afterResume = record({ sessionId: SESSION_1, invocations: [] });
    expect(
      unevaluatedRequirements([requirement(REQ_A, "A")], [beforePark, afterResume], CHANGE_SET),
    ).toStrictEqual([]);
  });

  /** Supersession is PER WORK UNIT — one unit's repair must not invalidate another unit's verification. */
  it("scopes supersession to the work unit, never across units", () => {
    const unitAVerified = record({ workUnitId: UNIT, sessionId: SESSION_1 });
    const unitBRepairedWithoutTests = record({
      workUnitId: UNIT_B,
      sessionId: SESSION_2,
      requirementIds: [REQ_B],
      invocations: [{ prefix: "npm run build", invocations: 1, cleanExits: 1 }],
    });
    const found = unevaluatedRequirements(
      [requirement(REQ_A, "A"), requirement(REQ_B, "B")],
      [unitAVerified, unitBRepairedWithoutTests],
      CHANGE_SET,
    );
    expect(found.map((entry) => entry.requirementId)).toStrictEqual([REQ_B]);
  });

  it("returns unevaluated requirements in declaration order, so a refusal reads in contract order", () => {
    const found = unevaluatedRequirements(
      [requirement(REQ_B, "B"), requirement(REQ_A, "A")],
      [],
      CHANGE_SET,
    );
    expect(found.map((entry) => entry.title)).toStrictEqual(["B", "A"]);
  });
});

describe("isEvaluationEvidence", () => {
  it("is false for a record with no invocations at all", () => {
    expect(isEvaluationEvidence(record({ invocations: [] }))).toBe(false);
  });

  it("is true only when an acceptance-class grant exited clean at least once", () => {
    expect(
      isEvaluationEvidence(
        record({ invocations: [{ prefix: "npm run test", invocations: 3, cleanExits: 1 }] }),
      ),
    ).toBe(true);
  });
});

describe("describeObservations", () => {
  /**
   * The half of the refusal that tells an operator what to DO. "invoked 12x, 0
   * clean" and "no granted command was invoked" call for different actions —
   * fix the command path, versus find out why the worker never tried — and a
   * refusal that merged them would be the unactionable failure the ruling
   * explicitly warns against.
   */
  it("separates 'never attempted' from 'attempted and never worked'", () => {
    const never = describeObservations([record({ invocations: [] })], CHANGE_SET);
    const tried = describeObservations(
      [record({ invocations: [{ prefix: "npm run test", invocations: 12, cleanExits: 0 }] })],
      CHANGE_SET,
    );
    expect(never[0]).toContain("no granted command was invoked");
    expect(tried[0]).toContain("npm run test (acceptance) invoked 12x, 0 clean");
  });

  /**
   * A refusal that printed a superseded attempt's clean test run unlabelled,
   * beside "these criteria were never evaluated", reads as a contradiction —
   * and dropping it silently hides the one case an operator would most need
   * explained.
   */
  it("labels a superseded attempt rather than hiding it or reporting it as current", () => {
    const lines = describeObservations(
      [
        record({ sessionId: SESSION_1 }),
        record({
          sessionId: SESSION_2,
          invocations: [{ prefix: "npm run build", invocations: 1, cleanExits: 1 }],
        }),
      ],
      CHANGE_SET,
    );
    expect(lines[0]).toContain("[superseded by a later attempt]");
    expect(lines[1]).not.toContain("superseded");
  });

  it("describes only this change set's records", () => {
    expect(describeObservations([record({ changeSetId: OTHER_CHANGE_SET })], CHANGE_SET)).toStrictEqual(
      [],
    );
  });
});
