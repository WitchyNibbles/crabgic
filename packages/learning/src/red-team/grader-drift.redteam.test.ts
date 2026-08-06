import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { GraderDriftError } from "../errors.js";
import { EvalCaseSchema, type EvalCase } from "../eval/case-schema.js";
import { caseSetDigest, runEvalPair, type EvalCaseSource } from "../eval/eval-pair.js";
import { CaseFixtureStore } from "../store/case-fixture-store.js";

/**
 * `@learning-redteam` — roadmap/22-learning-system.md §Exit criteria:
 * "… grader-drift attempt blocked … — each a separate passing case in the
 * `@learning-redteam` suite." §In scope, Separation of duties: "proposer
 * cannot modify its grader, held-out cases, or promotion criteria."
 *
 * WHY THIS NEEDED A PRODUCTION BRANCH AT ALL, rather than being read as
 * covered by grader-isolation's `seal()` (measured at `c0b3873`, not
 * argued):
 *
 *   1. `git grep 'CaseFixtureStore|\.seal\('` outside tests hits only the
 *      barrel export `../index.ts` — in the shipped system the seal is
 *      never established, so nothing can be subsumed by it.
 *   2. Only `grader/held-out/` is ever sealed; `grader/dev/` has no seal
 *      step at all (`../store/layout.ts`).
 *   3. Structurally, a seal cannot catch this: `runEvalSuite` grades a
 *      caller-supplied in-memory array and is never told where it came
 *      from, so a mutation of the SOURCE between the dev eval and the
 *      held-out eval was invisible to every line of code that existed.
 *      `git grep -ni 'grader.drift|reward.hack' -- packages/learning/src`
 *      exited 1.
 *
 * The seal refuses a WRITE. This refuses to GRADE against anything but the
 * pre-committed set, whoever wrote it — content-based, so unlike
 * `./grader-isolation.redteam.test.ts` nothing here depends on POSIX mode
 * bits. No timers anywhere: the drift window is opened by call COUNT, never
 * by wall clock.
 */
const TAMPERED_REQUIREMENT_ID = "77777777-7777-4777-8777-777777777777";

let root: string;
let journal: JournalStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-learning-grader-drift-"));
  journal = createJournalStore({ journalDir: join(root, "journal") });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function caseOf(
  id: string,
  provenanceId: string,
  overrides: Record<string, unknown> = {},
): EvalCase {
  return EvalCaseSchema.parse({
    id,
    input: { actualJudgment: true, scenario: id },
    expectedJudgment: true,
    provenanceId,
    ...overrides,
  });
}

/** A counting in-memory source — `reads` is what proves the pin really re-read. */
function source(cases: readonly EvalCase[]): EvalCaseSource & { reads: number } {
  return {
    reads: 0,
    async read(): Promise<readonly EvalCase[]> {
      this.reads += 1;
      return cases;
    },
  };
}

describe("@learning-redteam grader drift — a held-out set mutated between dev eval and held-out eval is refused", () => {
  it("refuses with GraderDriftError when the held-out set is RELABELLED between the pin and grading, and never grades the drifted set", async () => {
    // The classic reward hack: an attacker flips a held-out case's expected
    // judgment so the candidate scores against a bar it did not clear.
    const spyJournal = { queryEntries: vi.fn(journal.queryEntries.bind(journal)) };
    const dev = source([caseOf("dev-1", "p-dev")]);
    const heldOut: EvalCaseSource & { reads: number } = {
      reads: 0,
      async read(): Promise<readonly EvalCase[]> {
        this.reads += 1;
        return this.reads === 1
          ? [caseOf("ho-1", "p-ho")]
          : [
              caseOf("ho-1", "p-ho", {
                expectedJudgment: false,
                groundTruthRequirementId: TAMPERED_REQUIREMENT_ID,
              }),
            ];
      },
    };

    await expect(runEvalPair({ dev, heldOut }, spyJournal)).rejects.toThrow(GraderDriftError);
    expect(heldOut.reads).toBe(2); // the pin really re-read; it is not comparing a value to itself
    // The drifted case carries a ground-truth link, so ANY grading of it
    // would have hit the journal. It never did.
    expect(spyJournal.queryEntries).not.toHaveBeenCalled();
  });

  it("refuses a rename that leaves CONTENT identical — the pin covers case IDENTITY, not only `computeCaseHash`", async () => {
    // `computeCaseHash` deliberately covers only `input` + `expectedJudgment`
    // (it is the contamination oracle, where two differently-named copies of
    // the same content ARE the finding). Swapping which cases are in the
    // held-out set, without changing any case's content, is still a changed
    // grader. `caseSetDigest` therefore covers every member of the `.strict()`
    // `EvalCaseSchema`, pinned exhaustively by the last case in this file.
    const dev = source([caseOf("dev-1", "p-dev")]);
    const heldOut: EvalCaseSource & { reads: number } = {
      reads: 0,
      async read(): Promise<readonly EvalCase[]> {
        this.reads += 1;
        // Same `input.scenario`, same `expectedJudgment` — only the id and
        // provenance move, so `computeCaseHash` alone cannot see this.
        return this.reads === 1
          ? [
              EvalCaseSchema.parse({
                id: "ho-1",
                input: { actualJudgment: true, scenario: "fixed" },
                expectedJudgment: true,
                provenanceId: "p-ho",
              }),
            ]
          : [
              EvalCaseSchema.parse({
                id: "ho-1-renamed",
                input: { actualJudgment: true, scenario: "fixed" },
                expectedJudgment: true,
                provenanceId: "p-ho-renamed",
              }),
            ];
      },
    };

    await expect(runEvalPair({ dev, heldOut }, journal)).rejects.toThrow(GraderDriftError);
  });

  it("refuses when the mutation happens ON DISK, through a real (unsealed) CaseFixtureStore", async () => {
    const heldOutStore = new CaseFixtureStore(join(root, "held-out"));
    await heldOutStore.write([caseOf("ho-1", "p-ho")]);
    const tampered = caseOf("ho-1", "p-ho", { expectedJudgment: false });

    // Deterministic TOCTOU, driven by call count and nothing else: read #1
    // returns the pre-image (which `runEvalPair` pins) and only THEN rewrites
    // the file, so the hostile edit lands strictly between the pin and the
    // re-read that grading would use.
    const tocTou: EvalCaseSource & { reads: number } = {
      reads: 0,
      async read(): Promise<readonly EvalCase[]> {
        this.reads += 1;
        const current = await heldOutStore.read();
        if (this.reads === 1) await heldOutStore.write([tampered]);
        return current;
      },
    };

    await expect(
      runEvalPair({ dev: source([caseOf("dev-1", "p-dev")]), heldOut: tocTou }, journal),
    ).rejects.toThrow(GraderDriftError);
    expect(tocTou.reads).toBe(2);
    // The hostile write really landed — this case is not passing because the
    // rewrite silently failed and both reads saw the same bytes.
    expect(await heldOutStore.read()).toEqual([tampered]);
  });

  it("CONTROL: an un-mutated pair grades both suites and does not throw", async () => {
    const dev = source([caseOf("dev-1", "p-dev")]);
    const heldOut = source([caseOf("ho-1", "p-ho")]);
    const result = await runEvalPair({ dev, heldOut }, journal);
    expect(result.dev.passed).toBe(true);
    expect(result.heldOut.passed).toBe(true);
    expect(heldOut.reads).toBe(2);
  });

  it("the digest input covers every member of EvalCaseSchema — a new field cannot silently escape the pin", () => {
    // A residual asserted rather than described: if someone adds a sixth
    // member to `EvalCaseSchema`, this reddens and `caseSetDigest` must be
    // widened to cover it, instead of the new field drifting unpinned.
    expect(Object.keys(EvalCaseSchema.shape).sort()).toEqual([
      "expectedJudgment",
      "groundTruthRequirementId",
      "id",
      "input",
      "provenanceId",
    ]);

    // And it really discriminates on each of them.
    const base = caseOf("a", "p-a");
    expect(caseSetDigest([base])).not.toBe(caseSetDigest([{ ...base, id: "b" }]));
    expect(caseSetDigest([base])).not.toBe(caseSetDigest([{ ...base, provenanceId: "p-b" }]));
    expect(caseSetDigest([base])).not.toBe(caseSetDigest([{ ...base, expectedJudgment: false }]));
    expect(caseSetDigest([base])).not.toBe(
      caseSetDigest([{ ...base, input: { actualJudgment: false } }]),
    );
    expect(caseSetDigest([base])).not.toBe(
      caseSetDigest([{ ...base, groundTruthRequirementId: TAMPERED_REQUIREMENT_ID }]),
    );
    // Order is not content: the same SET in a different order is the same set.
    const other = caseOf("b", "p-b");
    expect(caseSetDigest([base, other])).toBe(caseSetDigest([other, base]));
  });
});
