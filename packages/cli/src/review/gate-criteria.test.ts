import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "@crabgic/contracts";
import {
  FINAL_CANDIDATE_CRITERION,
  GATES_PASS_CRITERION,
  GATE_DERIVED_CRITERIA,
  TESTS_FIRST_CRITERION,
  deriveGateCriteria,
} from "./gate-criteria.js";

/**
 * Deriving the gate-decidable exit criteria from journaled evidence, instead of
 * believing the caller.
 *
 * `review.submit` takes `metCriteria` as an input, which means an orchestrator
 * that misreports its gate results is believed — a limit ledger Gap 20 records
 * honestly rather than glossing. This closes it for the criteria a tool can
 * genuinely decide.
 *
 * TWO CORRECTIONS THIS FILE ENCODES, both found by re-reading the emitters:
 *
 *   1. `exitStatus` is NOT the verdict. `createTddGate` returns `passed: false`
 *      while reporting the candidate's own `exitStatus: 0` when no red baseline
 *      exists, so scoring exit status reads a FAILED gate as passing. The
 *      handler's own judgement is now on the record and is what gets scored.
 *   2. A gate's history is not its result. The journal is append-only, so an
 *      earlier failing firing lives beside the later passing one forever;
 *      requiring EVERY record to pass meant one fixed failure disqualified the
 *      ChangeSet permanently. The LATEST firing per tag is the tag's result.
 */

let counter = 0;

function record(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  counter += 1;
  return {
    schemaVersion: 1,
    id: `11111111-1111-4111-8111-${String(counter).padStart(12, "0")}`,
    changeSetId: "22222222-2222-4222-8222-222222222222",
    command: "npm run test",
    exitStatus: 0,
    toolchainFingerprint: "node24",
    capturedAt: `2026-07-29T00:00:${String(counter).padStart(2, "0")}.000Z`,
    artifactDigests: [],
    objectId: "candidate",
    gateTag: "tdd",
    gateVerdict: "passed",
    ...overrides,
  } as EvidenceRecord;
}

describe("deriveGateCriteria — implement-gates-pass", () => {
  it("reports the criterion met when every tag's latest firing passed", () => {
    const met = deriveGateCriteria([record(), record({ gateTag: "coverage" })]);
    expect(met).toContain(GATES_PASS_CRITERION);
  });

  it("does NOT report it met when any tag's latest firing failed", () => {
    const met = deriveGateCriteria([
      record(),
      record({ gateTag: "coverage", gateVerdict: "failed", exitStatus: 1 }),
    ]);
    expect(met).not.toContain(GATES_PASS_CRITERION);
  });

  /**
   * The case that matters most, and the one a caller-supplied boolean gets
   * wrong for free: gates that never ran are not gates that passed. An empty
   * evidence set is absence of proof, and treating it as proof of absence is
   * how a stage closes on work nobody verified.
   */
  it("does NOT report it met when NO gate has run at all", () => {
    expect(deriveGateCriteria([])).not.toContain(GATES_PASS_CRITERION);
  });

  it("ignores evidence that is not a gate firing", () => {
    // Gap 6's rendered-artifact evidence carries no gate tag and is not a gate
    // verdict; counting it would let a stage pass on evidence of the wrong kind.
    const met = deriveGateCriteria([record({ gateTag: undefined, gateVerdict: undefined })]);
    expect(met).not.toContain(GATES_PASS_CRITERION);
  });

  it("ignores a nonzero exit on a record that is not a gate firing", () => {
    const met = deriveGateCriteria([
      record(),
      record({ gateTag: undefined, gateVerdict: undefined, exitStatus: 1 }),
    ]);
    expect(met).toContain(GATES_PASS_CRITERION);
  });

  /**
   * THE BUG THIS FILE WAS REWRITTEN FOR.
   *
   * `captureRedBaseline` journals `gateTag: "tdd"` with a nonzero exit, on
   * purpose, and throws if you hand it a zero. Under the old "every gate-tagged
   * record must be a zero exit" rule, doing TDD correctly made
   * `implement-gates-pass` UNDERIVABLE for the rest of that ChangeSet's life —
   * the implement stage could never close on evidence, only on the caller's
   * word, which is the exact thing this module exists to stop.
   *
   * A red baseline reports no verdict, because it is a pre-dispatch capture
   * rather than a firing. That is how it is skipped.
   */
  it("is not poisoned by a TDD red baseline", () => {
    const redBaseline = record({
      gateTag: "tdd",
      gateVerdict: undefined,
      exitStatus: 1,
      objectId: "base",
    });
    const greenFiring = record({ gateTag: "tdd" });
    expect(deriveGateCriteria([redBaseline, greenFiring])).toContain(GATES_PASS_CRITERION);
  });

  /**
   * The same defect in its second form. A gate that failed, got fixed, and was
   * re-fired leaves both records behind forever.
   */
  it("scores the latest firing per tag, not the whole append-only history", () => {
    const failedFirst = record({ gateTag: "coverage", gateVerdict: "failed", exitStatus: 1 });
    const passedAfter = record({ gateTag: "coverage" });
    expect(deriveGateCriteria([failedFirst, passedAfter])).toContain(GATES_PASS_CRITERION);
  });

  /** And it must not run the other way — a later failure supersedes an earlier pass. */
  it("does not let an earlier pass survive a later failure", () => {
    const passedFirst = record({ gateTag: "coverage" });
    const failedAfter = record({ gateTag: "coverage", gateVerdict: "failed", exitStatus: 1 });
    expect(deriveGateCriteria([passedFirst, failedAfter])).not.toContain(GATES_PASS_CRITERION);
  });

  /**
   * Ordering comes from `capturedAt` and falls back to position, never from
   * position alone. `queryEvidence` happens to return journal order today, and a
   * derivation that silently depended on that would be wrong the moment it
   * stopped — the same coupling `runReviewSubmit` already refuses for finding
   * dispositions.
   */
  it("orders by capturedAt rather than array position", () => {
    const later = record({ gateTag: "coverage", capturedAt: "2026-07-29T12:00:00.000Z" });
    const earlierButLast = record({
      gateTag: "coverage",
      gateVerdict: "failed",
      exitStatus: 1,
      capturedAt: "2026-07-29T01:00:00.000Z",
    });
    expect(deriveGateCriteria([later, earlierButLast])).toContain(GATES_PASS_CRITERION);
  });

  /**
   * A gate-tagged record with no verdict at all is not evidence of a pass. Old
   * records journaled before `gateVerdict` existed land here, and they fail
   * closed: the tag has no scoreable result, so nothing derives until it fires
   * again.
   */
  it("does not count a tag whose only record carries no verdict", () => {
    const met = deriveGateCriteria([record({ gateTag: "coverage", gateVerdict: undefined })]);
    expect(met).not.toContain(GATES_PASS_CRITERION);
  });
});

/**
 * `implement-tests-first` — "the work has tests that failed before it and pass
 * after it, per the repository's TDD ground rule."
 *
 * That sentence describes the `tdd` gate exactly. `createTddGate` passes only
 * when a red-baseline `EvidenceRecord` exists STRICTLY BEFORE the candidate's own
 * dispatch boundary AND this candidate's run is green — red before, green after,
 * with the ordering belt already enforced by the gate rather than re-derived
 * here. So a passing `tdd` verdict IS this criterion, and asking a caller to
 * assert it separately was asking for a second opinion on something already
 * decided.
 */
describe("deriveGateCriteria — implement-tests-first", () => {
  it("is met by a passing tdd firing", () => {
    expect(deriveGateCriteria([record({ gateTag: "tdd" })])).toContain(TESTS_FIRST_CRITERION);
  });

  it("is NOT met when the tdd gate failed", () => {
    // The zero exit is the point: this is the shape a TDD gate failure takes
    // when the candidate's tests pass but no red baseline was ever captured.
    const met = deriveGateCriteria([
      record({ gateTag: "tdd", gateVerdict: "failed", exitStatus: 0 }),
    ]);
    expect(met).not.toContain(TESTS_FIRST_CRITERION);
  });

  it("is NOT met when the tdd gate never fired, however green everything else is", () => {
    const met = deriveGateCriteria([record({ gateTag: "coverage" })]);
    expect(met).toContain(GATES_PASS_CRITERION);
    expect(met).not.toContain(TESTS_FIRST_CRITERION);
  });

  it("is NOT met by a red baseline alone", () => {
    const met = deriveGateCriteria([
      record({ gateTag: "tdd", gateVerdict: undefined, exitStatus: 1, objectId: "base" }),
    ]);
    expect(met).not.toContain(TESTS_FIRST_CRITERION);
  });
});

/**
 * `integrate-final-candidate-gate` — "the final-candidate gate passes on the
 * EXACT merge candidate, not on an earlier commit."
 *
 * The candidate object id is an input because nothing in the evidence can say
 * which object is being merged. That is not the same as trusting the caller with
 * the criterion: naming an object id does not produce passing gates for it, and
 * the derivation still requires every tag's latest firing to be green AT that
 * exact id. What a caller can do is name an OLDER fully-green object — recorded
 * as the residual, and narrower than "the caller asserts the gate passed".
 *
 * With no candidate id supplied, nothing derives. That fails closed: the
 * integrate stage then cannot close at all, rather than closing on a claim.
 */
describe("deriveGateCriteria — integrate-final-candidate-gate", () => {
  it("is met when every tag's latest firing passed at the named candidate", () => {
    const met = deriveGateCriteria(
      [record({ objectId: "merge-me" }), record({ gateTag: "coverage", objectId: "merge-me" })],
      { candidateObjectId: "merge-me" },
    );
    expect(met).toContain(FINAL_CANDIDATE_CRITERION);
  });

  it("is NOT met when a gate's latest firing was against an earlier object", () => {
    const met = deriveGateCriteria(
      [record({ objectId: "merge-me" }), record({ gateTag: "coverage", objectId: "older" })],
      { candidateObjectId: "merge-me" },
    );
    expect(met).not.toContain(FINAL_CANDIDATE_CRITERION);
    // The gates themselves all passed — this criterion is about WHERE, which is
    // the whole distinction the criterion's own wording draws.
    expect(met).toContain(GATES_PASS_CRITERION);
  });

  it("is NOT met when no candidate object id is supplied", () => {
    const met = deriveGateCriteria([record({ objectId: "merge-me" })]);
    expect(met).not.toContain(FINAL_CANDIDATE_CRITERION);
  });

  it("is NOT met when a gate failed at the candidate", () => {
    const met = deriveGateCriteria(
      [record({ gateTag: "coverage", gateVerdict: "failed", objectId: "merge-me" })],
      { candidateObjectId: "merge-me" },
    );
    expect(met).not.toContain(FINAL_CANDIDATE_CRITERION);
  });

  it("is NOT met when no gate fired at the candidate at all", () => {
    const met = deriveGateCriteria([record({ objectId: "older" })], {
      candidateObjectId: "merge-me",
    });
    expect(met).not.toContain(FINAL_CANDIDATE_CRITERION);
  });
});

/**
 * The set exists so the composition root subtracts exactly what this module can
 * derive, rather than keeping a second list that drifts from this one.
 */
describe("GATE_DERIVED_CRITERIA", () => {
  it("names every criterion this module can derive, and nothing else", () => {
    expect([...GATE_DERIVED_CRITERIA].sort()).toEqual(
      [GATES_PASS_CRITERION, TESTS_FIRST_CRITERION, FINAL_CANDIDATE_CRITERION].sort(),
    );
  });

  it("contains every criterion any derivation can actually return", () => {
    const everything = new Set([
      ...deriveGateCriteria(
        [record({ gateTag: "tdd", objectId: "c" }), record({ gateTag: "coverage", objectId: "c" })],
        { candidateObjectId: "c" },
      ),
    ]);
    for (const criterion of everything) {
      expect(GATE_DERIVED_CRITERIA).toContain(criterion);
    }
    // And the reverse — the fixture above is built to trip all three, so a
    // criterion added to the list without a derivation is caught here.
    expect(everything.size).toBe(GATE_DERIVED_CRITERIA.length);
  });
});
