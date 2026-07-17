import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  WORK_UNIT_ATTEMPT_STATUSES,
  WORK_UNIT_ATTEMPT_STATUS_TERMINALS,
  WORK_UNIT_ATTEMPT_STATUS_TRANSITIONS,
  WorkUnitAttemptStatusSchema,
  isWorkUnitAttemptStatusAbsorbing,
  isWorkUnitAttemptStatusTerminal,
  workUnitAttemptStatusTransition,
} from "./work-unit-attempt-status.js";
import { IllegalTransitionError } from "./transition-table.js";

describe("WorkUnitAttemptStatusSchema", () => {
  it("accepts every declared member, including the colon-bearing parked:rate_limit", () => {
    for (const status of WORK_UNIT_ATTEMPT_STATUSES) {
      expect(WorkUnitAttemptStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("has exactly 6 members", () => {
    expect(WORK_UNIT_ATTEMPT_STATUSES.length).toBe(6);
  });

  it("rejects a member outside the closed union", () => {
    expect(WorkUnitAttemptStatusSchema.safeParse("parked:budget").success).toBe(false);
  });
});

describe("WorkUnitAttemptStatus transition table — every declared edge", () => {
  for (const [from, tos] of Object.entries(WORK_UNIT_ATTEMPT_STATUS_TRANSITIONS)) {
    for (const to of tos) {
      it(`allows ${from} -> ${to}`, () => {
        expect(workUnitAttemptStatusTransition(from as never, to as never)).toBe(to);
      });
    }
  }
});

describe("WorkUnitAttemptStatus transition table — declared shape", () => {
  it("pending -> {dispatched, cancelled}", () => {
    expect(WORK_UNIT_ATTEMPT_STATUS_TRANSITIONS.pending).toEqual(["dispatched", "cancelled"]);
  });

  it("dispatched -> {succeeded, failed, cancelled, parked:rate_limit}", () => {
    expect(WORK_UNIT_ATTEMPT_STATUS_TRANSITIONS.dispatched).toEqual([
      "succeeded",
      "failed",
      "cancelled",
      "parked:rate_limit",
    ]);
  });

  it("parked:rate_limit -> dispatched ONLY (reachable only from, and returning only to, dispatched)", () => {
    expect(WORK_UNIT_ATTEMPT_STATUS_TRANSITIONS["parked:rate_limit"]).toEqual(["dispatched"]);

    // reachable only from dispatched: no other state's transition list names it
    for (const [from, tos] of Object.entries(WORK_UNIT_ATTEMPT_STATUS_TRANSITIONS)) {
      if (from === "dispatched") continue;
      expect(tos).not.toContain("parked:rate_limit");
    }
  });

  it("the canonical illegal parked:rate_limit -> succeeded fixture throws (work item 3 failing-first fixture)", () => {
    expect(() => workUnitAttemptStatusTransition("parked:rate_limit", "succeeded")).toThrow(
      IllegalTransitionError,
    );
  });

  it.each(WORK_UNIT_ATTEMPT_STATUS_TERMINALS)("%s is terminal/absorbing", (terminal) => {
    expect(WORK_UNIT_ATTEMPT_STATUS_TRANSITIONS[terminal]).toEqual([]);
    expect(isWorkUnitAttemptStatusAbsorbing(terminal)).toBe(true);
    expect(isWorkUnitAttemptStatusTerminal(terminal)).toBe(true);
  });

  it("exactly 3 terminals", () => {
    expect(WORK_UNIT_ATTEMPT_STATUS_TERMINALS.length).toBe(3);
  });
});

describe("WorkUnitAttemptStatus — illegal samples", () => {
  it.each([
    ["pending", "succeeded"],
    ["pending", "failed"],
    ["pending", "parked:rate_limit"],
    ["succeeded", "dispatched"],
    ["failed", "dispatched"],
    ["cancelled", "pending"],
    ["parked:rate_limit", "failed"],
    ["parked:rate_limit", "cancelled"],
    ["parked:rate_limit", "pending"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(() => workUnitAttemptStatusTransition(from, to)).toThrow(IllegalTransitionError);
  });
});

const statusArbitrary = fc.constantFrom(...WORK_UNIT_ATTEMPT_STATUSES);

describe("WorkUnitAttemptStatus fuzz (fast-check, >=10k cases, 6-state space)", () => {
  it("never reaches an undeclared state; parked:rate_limit only ever touches dispatched; terminals absorb", () => {
    fc.assert(
      fc.property(
        statusArbitrary,
        fc.array(statusArbitrary, { minLength: 1, maxLength: 40 }),
        (start, attempts) => {
          let current = start;

          for (const candidate of attempts) {
            const allowed = WORK_UNIT_ATTEMPT_STATUS_TRANSITIONS[current];

            if (isWorkUnitAttemptStatusAbsorbing(current)) {
              expect(() => workUnitAttemptStatusTransition(current, candidate)).toThrow(
                IllegalTransitionError,
              );
              continue;
            }

            if (allowed.includes(candidate)) {
              const previous = current;
              current = workUnitAttemptStatusTransition(current, candidate);
              expect(WORK_UNIT_ATTEMPT_STATUSES).toContain(current);
              if (previous === "parked:rate_limit") {
                expect(current).toBe("dispatched");
              }
              if (current === "parked:rate_limit") {
                expect(previous).toBe("dispatched");
              }
            } else {
              expect(() => workUnitAttemptStatusTransition(current, candidate)).toThrow(
                IllegalTransitionError,
              );
            }
          }

          return true;
        },
      ),
      { numRuns: 10_000 },
    );
  });
});
