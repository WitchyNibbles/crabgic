import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  RUN_LIFECYCLE_STATES,
  RUN_LIFECYCLE_TERMINAL_STATES,
  RUN_LIFECYCLE_TRANSITIONS,
  RunLifecycleStateSchema,
  isRunLifecycleAbsorbing,
  isRunLifecycleTerminal,
  runLifecycleTransition,
} from "./run-lifecycle.js";
import { IllegalTransitionError } from "./transition-table.js";

describe("RunLifecycleStateSchema", () => {
  it("accepts every declared state", () => {
    for (const state of RUN_LIFECYCLE_STATES) {
      expect(RunLifecycleStateSchema.safeParse(state).success).toBe(true);
    }
  });

  it("rejects a state outside the closed union", () => {
    expect(RunLifecycleStateSchema.safeParse("archived").success).toBe(false);
  });

  it("has exactly 11 members (8 states + 3 terminals)", () => {
    expect(RUN_LIFECYCLE_STATES.length).toBe(11);
    expect(RUN_LIFECYCLE_TERMINAL_STATES.length).toBe(3);
  });
});

describe("run-lifecycle transition table — every declared edge", () => {
  for (const [from, tos] of Object.entries(RUN_LIFECYCLE_TRANSITIONS)) {
    for (const to of tos) {
      it(`allows ${from} -> ${to}`, () => {
        expect(runLifecycleTransition(from as never, to as never)).toBe(to);
      });
    }
  }
});

describe("run-lifecycle transition table — illegal samples", () => {
  it.each([
    ["draft", "running"],
    ["awaiting_approval", "running"],
    ["ready", "verifying"],
    ["running", "draft"],
    ["published_local", "running"],
    ["published_local", "draft"],
    ["failed", "running"],
    ["blocked", "cancelled"],
    ["cancelled", "draft"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(() => runLifecycleTransition(from, to)).toThrow(IllegalTransitionError);
  });

  it("the canonical illegal draft -> running fixture throws IllegalTransitionError (work item 2 failing-first fixture)", () => {
    expect(() => runLifecycleTransition("draft", "running")).toThrow(
      /illegal transition from "draft" to "running"/,
    );
  });
});

describe("run-lifecycle — terminals absorb", () => {
  it.each(RUN_LIFECYCLE_TERMINAL_STATES)("%s has no outgoing transitions", (terminal) => {
    expect(RUN_LIFECYCLE_TRANSITIONS[terminal]).toEqual([]);
    expect(isRunLifecycleAbsorbing(terminal)).toBe(true);
    expect(isRunLifecycleTerminal(terminal)).toBe(true);
  });

  it("published_local also has no outgoing transitions (absorbing, but not a 'terminal' by name)", () => {
    expect(RUN_LIFECYCLE_TRANSITIONS.published_local).toEqual([]);
    expect(isRunLifecycleAbsorbing("published_local")).toBe(true);
    expect(isRunLifecycleTerminal("published_local")).toBe(false);
  });

  it("every non-absorbing state has at least one outgoing transition", () => {
    for (const state of RUN_LIFECYCLE_STATES) {
      if (!isRunLifecycleAbsorbing(state)) {
        expect(RUN_LIFECYCLE_TRANSITIONS[state].length).toBeGreaterThan(0);
      }
    }
  });
});

const stateArbitrary = fc.constantFrom(...RUN_LIFECYCLE_STATES);

describe("run-lifecycle fuzz (fast-check, >=10k cases)", () => {
  it("never reaches an undeclared state; terminals/published_local absorb permanently", () => {
    fc.assert(
      fc.property(
        stateArbitrary,
        fc.array(stateArbitrary, { minLength: 1, maxLength: 40 }),
        (start, attempts) => {
          let current = start;
          let sawAbsorbing = false;

          for (const candidate of attempts) {
            const allowed = RUN_LIFECYCLE_TRANSITIONS[current];

            if (sawAbsorbing) {
              // Once we've reached an absorbing state, every further attempt must throw
              // and `current` must never move.
              expect(() => runLifecycleTransition(current, candidate)).toThrow(
                IllegalTransitionError,
              );
              continue;
            }

            if (allowed.includes(candidate)) {
              current = runLifecycleTransition(current, candidate);
              expect(RUN_LIFECYCLE_STATES).toContain(current);
            } else {
              expect(() => runLifecycleTransition(current, candidate)).toThrow(
                IllegalTransitionError,
              );
            }

            if (isRunLifecycleAbsorbing(current)) {
              sawAbsorbing = true;
            }
          }

          return true;
        },
      ),
      { numRuns: 10_000 },
    );
  });
});
