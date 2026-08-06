import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { ContaminationDetectedError } from "../errors.js";
import { EvalCaseSchema, computeCaseHash, type EvalCase } from "../eval/case-schema.js";
import { runEvalPair, type EvalCaseSource } from "../eval/eval-pair.js";

/**
 * `@learning-redteam` — roadmap/22-learning-system.md §Exit criteria: "Held-out
 * contamination detected … each a separate passing case in the
 * `@learning-redteam` suite"; §Test plan, Security: "contamination (dev/held-out
 * case-hash overlap, shared provenance) must be detected BEFORE eval runs."
 *
 * WHAT MAKES THIS A RED-TEAM CASE RATHER THAN A COPY OF
 * `../eval/contamination.test.ts`: that suite pins the VERDICT of the pure
 * detector. This one pins the ORDERING guarantee the criterion actually
 * states, by giving one case a `groundTruthRequirementId` — the only input
 * that makes grading consult the journal at all — and then asserting the
 * journal was never consulted. A refusal that happens after the held-out set
 * has already been graded would satisfy `contamination.test.ts` and fail here.
 *
 * Every refusal below is paired with the opposite outcome in the control case:
 * the same spy IS called for a disjoint pair, so "never called" is a
 * measurement rather than an artefact of a journal nothing ever touches.
 */
const GROUND_TRUTH_REQUIREMENT_ID = "88888888-8888-4888-8888-888888888888";

let root: string;
let journal: JournalStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-learning-contamination-rt-"));
  journal = createJournalStore({ journalDir: join(root, "journal") });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function source(cases: readonly EvalCase[]): EvalCaseSource {
  return { read: async () => cases };
}

function spyJournal() {
  return { queryEntries: vi.fn(journal.queryEntries.bind(journal)) };
}

describe("@learning-redteam contamination — a contaminated dev/held-out pair is refused BEFORE either eval fires", () => {
  it("case-hash overlap is refused, and no grading ever consults the journal", async () => {
    // Same `input` and same `expectedJudgment`, different id AND different
    // provenance — so the ONLY overlap is the content hash. Verified here
    // rather than assumed, because `computeCaseHash` covers exactly those two
    // members and nothing else.
    const shared = EvalCaseSchema.parse({
      id: "dev-shared",
      input: { actualJudgment: true, scenario: "identical-content" },
      expectedJudgment: true,
      provenanceId: "p-dev",
      groundTruthRequirementId: GROUND_TRUTH_REQUIREMENT_ID,
    });
    const sharedCopy = EvalCaseSchema.parse({
      id: "held-out-shared",
      input: { actualJudgment: true, scenario: "identical-content" },
      expectedJudgment: true,
      provenanceId: "p-held-out",
    });
    expect(computeCaseHash(shared)).toBe(computeCaseHash(sharedCopy));
    expect(shared.provenanceId).not.toBe(sharedCopy.provenanceId);

    const spy = spyJournal();
    await expect(
      runEvalPair({ dev: source([shared]), heldOut: source([sharedCopy]) }, spy),
    ).rejects.toThrow(ContaminationDetectedError);
    expect(spy.queryEntries).not.toHaveBeenCalled();
  });

  it("shared provenance is refused even when the content differs", async () => {
    const dev = EvalCaseSchema.parse({
      id: "dev-1",
      input: { actualJudgment: true, scenario: "dev-only-content" },
      expectedJudgment: true,
      provenanceId: "shared-provenance",
      groundTruthRequirementId: GROUND_TRUTH_REQUIREMENT_ID,
    });
    const heldOut = EvalCaseSchema.parse({
      id: "ho-1",
      input: { actualJudgment: true, scenario: "held-out-only-content" },
      expectedJudgment: true,
      provenanceId: "shared-provenance",
    });
    // The two arms are genuinely independent: this pair does NOT overlap by
    // content hash, so it can only be caught by the provenance arm.
    expect(computeCaseHash(dev)).not.toBe(computeCaseHash(heldOut));

    const spy = spyJournal();
    await expect(
      runEvalPair({ dev: source([dev]), heldOut: source([heldOut]) }, spy),
    ).rejects.toThrow(ContaminationDetectedError);
    expect(spy.queryEntries).not.toHaveBeenCalled();
  });

  it("CONTROL: a disjoint pair is graded, both suites pass, and the journal IS consulted", async () => {
    const dev = EvalCaseSchema.parse({
      id: "dev-1",
      input: { actualJudgment: true, scenario: "dev" },
      expectedJudgment: false, // no evidence recorded for this requirement -> judgment false
      provenanceId: "p-dev",
      groundTruthRequirementId: GROUND_TRUTH_REQUIREMENT_ID,
    });
    const heldOut = EvalCaseSchema.parse({
      id: "ho-1",
      input: { actualJudgment: true, scenario: "held-out" },
      expectedJudgment: true,
      provenanceId: "p-held-out",
    });

    const spy = spyJournal();
    const result = await runEvalPair({ dev: source([dev]), heldOut: source([heldOut]) }, spy);
    expect(result.dev.passed).toBe(true);
    expect(result.heldOut.passed).toBe(true);
    // This is what makes the two "not.toHaveBeenCalled" assertions above
    // load-bearing rather than free.
    expect(spy.queryEntries).toHaveBeenCalled();
  });
});
