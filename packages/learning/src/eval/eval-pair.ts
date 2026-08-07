import { createHash } from "node:crypto";
import type { JournalStore } from "@crabgic/journal";
import { GraderDriftError } from "../errors.js";
import { assertNoContamination } from "./contamination.js";
import { computeCaseHash, type EvalCase } from "./case-schema.js";
import { runEvalSuite, type EvalSuiteResult } from "./eval-runner.js";

/**
 * Anything that can be RE-READ at each stage. `CaseFixtureStore`
 * (`../store/case-fixture-store.ts`) satisfies this structurally, and so
 * does a bare in-memory array wrapper — deliberately, because the drift
 * this module refuses is not a filesystem event. A source that returns a
 * captured constant is trivially drift-free; the point is that a source
 * which can change between calls now has to prove it did not.
 */
export interface EvalCaseSource {
  read(): Promise<readonly EvalCase[]>;
}

export interface EvalPairResult {
  readonly dev: EvalSuiteResult;
  readonly heldOut: EvalSuiteResult;
}

/**
 * Digest of a case SET.
 *
 * ORDER-INSENSITIVE (per-case digests are sorted before hashing): reordering
 * the same cases is not a changed grader, and a source that reads a
 * directory is not obliged to enumerate it stably.
 *
 * IDENTITY-SENSITIVE, which `computeCaseHash` alone is not: that function
 * covers `input` + `expectedJudgment` only, because it is the CONTAMINATION
 * oracle, where two differently-named copies of one content ARE the finding.
 * Here the opposite is needed — swapping which cases make up the held-out
 * set, with every case's content untouched, is still a changed grader. So
 * every member of the `.strict()` `EvalCaseSchema` is folded in explicitly,
 * and `../red-team/grader-drift.redteam.test.ts`'s case "the digest input
 * covers every member of EvalCaseSchema" pins that this enumeration stays
 * exhaustive as the schema evolves. Two sibling cases there pin the
 * SERIALIZATION rather than the field list: "the per-case field separator is
 * unambiguous" sweeps a candidate set of printable separators, and
 * "caseSetDigest is byte-pinned to its exact serialization" recomputes the
 * expected digest from a literal statement of the format.
 *
 * Named, not numbered: an earlier version of this comment pointed at "the
 * last case in that file", which stopped being true the moment a case was
 * appended.
 */
export function caseSetDigest(cases: readonly EvalCase[]): string {
  const perCase = cases
    .map((c) =>
      [c.id, c.provenanceId, c.groundTruthRequirementId ?? "", computeCaseHash(c)].join("\0"),
    )
    .sort();
  return createHash("sha256").update(perCase.join("\n")).digest("hex");
}

/**
 * The one sequencing-enforcing eval entry point (roadmap/22 §Test plan,
 * Security: contamination "must be detected before eval runs"; §Exit
 * criteria: "grader-drift attempt blocked").
 *
 * Two guarantees, in this order:
 *
 *   1. Contamination is checked BEFORE either eval fires — not merely
 *      before the held-out one. `runEvalSuite` alone cannot offer this: it
 *      grades one set and is never shown the other.
 *   2. The HELD-OUT set is digest-pinned across the dev eval, and re-read
 *      at grading time. A mutation landing in that window is refused with
 *      `GraderDriftError` rather than silently graded.
 *
 * The held-out set is the pinned one, and the dev set is not, because the
 * dev set is fully consumed before the window opens — pinning it would
 * assert something no attacker can act on. Digest equality of the re-read
 * set also carries the contamination verdict forward unchanged, which is
 * why contamination is not re-checked after the re-read.
 *
 * PRODUCTION-CALLER STATUS, stated rather than implied: this function has
 * the same status as the rest of this package's eval infra — `runEvalSuite`
 * itself has no production caller either (measured at `c0b3873`; the only
 * non-test references are the barrel exports in `../index.ts`). It is the
 * package's canonical eval entry point, consumed by the red-team suite. The
 * criterion asks for a blocked ATTEMPT in that suite, not for daemon
 * wiring; claiming more would be exactly the oversold remedy that leaves a
 * control trusted and inert.
 */
export async function runEvalPair(
  sources: { readonly dev: EvalCaseSource; readonly heldOut: EvalCaseSource },
  journal: Pick<JournalStore, "queryEntries">,
): Promise<EvalPairResult> {
  const devCases = await sources.dev.read();
  const heldOutCases = await sources.heldOut.read();
  assertNoContamination(devCases, heldOutCases);
  const pinnedDigest = caseSetDigest(heldOutCases);

  const dev = await runEvalSuite(devCases, journal);

  const heldOutAtGradeTime = await sources.heldOut.read();
  const observedDigest = caseSetDigest(heldOutAtGradeTime);
  if (observedDigest !== pinnedDigest) {
    throw new GraderDriftError(pinnedDigest, observedDigest);
  }
  const heldOut = await runEvalSuite(heldOutAtGradeTime, journal);
  return { dev, heldOut };
}
