import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { emitEvidence, type GateContext, type GateVerdict } from "@eo/gates";
import { EvalCaseSchema } from "./case-schema.js";
import { gradeCase, runEvalSuite } from "./eval-runner.js";

let root: string;
let journal: JournalStore;

const REQUIREMENT_ID = "77777777-7777-4777-8777-777777777777";
const CHANGE_SET_ID = "88888888-8888-4888-8888-888888888888";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-learning-eval-runner-"));
  journal = createJournalStore({ journalDir: join(root, "journal") });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function verdict(passed: boolean): GateVerdict {
  return {
    passed,
    command: "npm test",
    exitStatus: passed ? 0 : 1,
    toolchainFingerprint: "node-24",
    artifactDigests: [],
    detail: passed ? "green" : "red",
  };
}

describe("gradeCase — ground-truth EvidenceRecord path (P14 as ground truth)", () => {
  it("passes when the recorded gate outcome matches the case's expected judgment", async () => {
    const context: GateContext = {
      stage: "verifying",
      changeSetId: CHANGE_SET_ID,
      objectId: "deadbeef",
      requirementId: REQUIREMENT_ID,
      journal,
    };
    await emitEvidence(journal, context, "tdd", verdict(true));

    const evalCase = EvalCaseSchema.parse({
      id: "case-gt-1",
      input: {},
      expectedJudgment: true,
      provenanceId: "prov-gt-1",
      groundTruthRequirementId: REQUIREMENT_ID,
    });

    const result = await gradeCase(evalCase, journal);
    expect(result.passed).toBe(true);
  });

  it("fails when the recorded gate outcome contradicts the case's expected judgment", async () => {
    const context: GateContext = {
      stage: "verifying",
      changeSetId: CHANGE_SET_ID,
      objectId: "deadbeef",
      requirementId: REQUIREMENT_ID,
      journal,
    };
    await emitEvidence(journal, context, "tdd", verdict(false));

    const evalCase = EvalCaseSchema.parse({
      id: "case-gt-2",
      input: {},
      expectedJudgment: true,
      provenanceId: "prov-gt-2",
      groundTruthRequirementId: REQUIREMENT_ID,
    });

    const result = await gradeCase(evalCase, journal);
    expect(result.passed).toBe(false);
  });

  it("no recorded evidence at all for the requirement counts as a false actual judgment", async () => {
    const evalCase = EvalCaseSchema.parse({
      id: "case-gt-3",
      input: {},
      expectedJudgment: false,
      provenanceId: "prov-gt-3",
      groundTruthRequirementId: "99999999-9999-4999-8999-999999999999",
    });
    const result = await gradeCase(evalCase, journal);
    expect(result.passed).toBe(true); // expected false, actual false (no evidence) -> match
  });
});

describe("gradeCase — fixture-modeled fallback path (no gate linkage)", () => {
  it("passes when input.actualJudgment matches expectedJudgment", async () => {
    const evalCase = EvalCaseSchema.parse({
      id: "case-fb-1",
      input: { actualJudgment: true },
      expectedJudgment: true,
      provenanceId: "prov-fb-1",
    });
    expect((await gradeCase(evalCase, journal)).passed).toBe(true);
  });

  it("fails when input.actualJudgment mismatches expectedJudgment", async () => {
    const evalCase = EvalCaseSchema.parse({
      id: "case-fb-2",
      input: { actualJudgment: false },
      expectedJudgment: true,
      provenanceId: "prov-fb-2",
    });
    expect((await gradeCase(evalCase, journal)).passed).toBe(false);
  });
});

describe("runEvalSuite", () => {
  it("passed=true only when every case passes", async () => {
    const cases = [
      EvalCaseSchema.parse({
        id: "c1",
        input: { actualJudgment: true },
        expectedJudgment: true,
        provenanceId: "p1",
      }),
      EvalCaseSchema.parse({
        id: "c2",
        input: { actualJudgment: true },
        expectedJudgment: true,
        provenanceId: "p2",
      }),
    ];
    const suite = await runEvalSuite(cases, journal);
    expect(suite.passed).toBe(true);
    expect(suite.results).toHaveLength(2);
  });

  it("passed=false when any case fails", async () => {
    const cases = [
      EvalCaseSchema.parse({
        id: "c1",
        input: { actualJudgment: true },
        expectedJudgment: true,
        provenanceId: "p1",
      }),
      EvalCaseSchema.parse({
        id: "c2",
        input: { actualJudgment: false },
        expectedJudgment: true,
        provenanceId: "p2",
      }),
    ];
    const suite = await runEvalSuite(cases, journal);
    expect(suite.passed).toBe(false);
  });
});
