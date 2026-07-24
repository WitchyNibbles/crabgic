import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { LEARNING_PROPOSAL_STATES, type LearningProposalState } from "@eo/contracts";
import {
  IllegalTransitionError,
  isLearningProposalAbsorbing,
  LEARNING_PROPOSAL_ABSORBING_STATES,
  LEARNING_PROPOSAL_TRANSITIONS,
  learningProposalTransition,
} from "./state-machine.js";

const ALL_STATES = LEARNING_PROPOSAL_STATES;

describe("LearningProposalState transition table — exhaustive", () => {
  it("declares every one of the 11 union members as a table key", () => {
    expect(Object.keys(LEARNING_PROPOSAL_TRANSITIONS).sort()).toEqual([...ALL_STATES].sort());
  });

  for (const from of ALL_STATES) {
    for (const to of ALL_STATES) {
      const legal = LEARNING_PROPOSAL_TRANSITIONS[from].includes(to);
      it(`${from} -> ${to} is ${legal ? "LEGAL" : "illegal (throws)"}`, () => {
        if (legal) {
          expect(learningProposalTransition(from, to)).toBe(to);
        } else {
          expect(() => learningProposalTransition(from, to)).toThrow(IllegalTransitionError);
        }
      });
    }
  }

  it("observation -> promoted (skipping the whole review pipeline) throws", () => {
    expect(() => learningProposalTransition("observation", "promoted")).toThrow(
      IllegalTransitionError,
    );
  });

  it("candidate -> independent_review (skipping both eval stages) throws", () => {
    expect(() => learningProposalTransition("candidate", "independent_review")).toThrow(
      IllegalTransitionError,
    );
  });

  it("dev_eval -> shadow_run (skipping held_out_eval) throws", () => {
    expect(() => learningProposalTransition("dev_eval", "shadow_run")).toThrow(
      IllegalTransitionError,
    );
  });

  it("shadow_run -> promoted (skipping independent_review) throws", () => {
    expect(() => learningProposalTransition("shadow_run", "promoted")).toThrow(
      IllegalTransitionError,
    );
  });

  it("rejected/rolled_back/expired are absorbing; every other state has outgoing edges", () => {
    for (const state of ALL_STATES) {
      expect(isLearningProposalAbsorbing(state)).toBe(
        (LEARNING_PROPOSAL_ABSORBING_STATES as readonly LearningProposalState[]).includes(state),
      );
    }
  });

  it("the error identifies the exact offending (machine, from, to)", () => {
    try {
      learningProposalTransition("promoted", "candidate");
      expect.fail("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalTransitionError);
      const typed = err as IllegalTransitionError<LearningProposalState>;
      expect(typed.machine).toBe("LearningProposalState");
      expect(typed.from).toBe("promoted");
      expect(typed.to).toBe("candidate");
    }
  });
});

describe("LearningProposalState — fast-check: no random walk ever reaches an undeclared edge", () => {
  const stateArb = fc.constantFrom(...ALL_STATES);

  it("every transition the pure function accepts is present in the table, and vice versa (10k cases)", () => {
    fc.assert(
      fc.property(stateArb, stateArb, (from, to) => {
        const legal = LEARNING_PROPOSAL_TRANSITIONS[from].includes(to);
        if (legal) {
          expect(learningProposalTransition(from, to)).toBe(to);
        } else {
          expect(() => learningProposalTransition(from, to)).toThrow(IllegalTransitionError);
        }
      }),
      { numRuns: 10_000 },
    );
  });

  it("no random walk of any length ever lands on 'promoted' without passing through dev_eval, held_out_eval, shadow_run, and independent_review in that order", () => {
    fc.assert(
      fc.property(fc.array(stateArb, { minLength: 1, maxLength: 12 }), (walk) => {
        let current: LearningProposalState = "observation";
        const visited: LearningProposalState[] = [current];
        for (const next of walk) {
          const legal = LEARNING_PROPOSAL_TRANSITIONS[current].includes(next);
          if (!legal) {
            expect(() => learningProposalTransition(current, next)).toThrow(IllegalTransitionError);
            continue; // illegal step: state does not advance, matching the real guard's refusal.
          }
          current = learningProposalTransition(current, next);
          visited.push(current);
        }
        if (current === "promoted") {
          const idxDevEval = visited.indexOf("dev_eval");
          const idxHeldOut = visited.indexOf("held_out_eval");
          const idxShadow = visited.indexOf("shadow_run");
          const idxReview = visited.indexOf("independent_review");
          expect(idxDevEval).toBeGreaterThanOrEqual(0);
          expect(idxHeldOut).toBeGreaterThan(idxDevEval);
          expect(idxShadow).toBeGreaterThan(idxHeldOut);
          expect(idxReview).toBeGreaterThan(idxShadow);
        }
      }),
      { numRuns: 5_000 },
    );
  });
});
