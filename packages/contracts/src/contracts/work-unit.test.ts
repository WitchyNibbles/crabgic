import { describe, expect, it } from "vitest";
import { WorkUnitSchema } from "./work-unit.js";
import { WORK_UNIT_ATTEMPT_STATUSES } from "../state-machines/work-unit-attempt-status.js";

const ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const DEPENDS_ON_ID = "33333333-3333-4333-8333-333333333333";
const REQUIREMENT_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_ID = "55555555-5555-4555-8555-555555555555";

function validWorkUnit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: ID,
    changeSetId: CHANGE_SET_ID,
    title: "Implement gateway MCP tool registry",
    requirementIds: [REQUIREMENT_ID],
    dependsOn: [DEPENDS_ON_ID],
    role: "implementation",
    ownedPaths: ["packages/gateway/src/**"],
    attemptStatus: "pending",
    ...overrides,
  };
}

describe("WorkUnitSchema", () => {
  it("parses a fully-valid fixture WITHOUT session_id (test plan: session_id optionality)", () => {
    const fixture = validWorkUnit();
    expect(fixture.session_id).toBeUndefined();
    const result = WorkUnitSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it("parses a fully-valid fixture WITH session_id present (test plan: session_id optionality)", () => {
    const result = WorkUnitSchema.safeParse(validWorkUnit({ session_id: SESSION_ID }));
    expect(result.success).toBe(true);
  });

  it("rejects an invalid-shape fixture (missing required changeSetId)", () => {
    const fixture = validWorkUnit();
    delete fixture.changeSetId;
    const result = WorkUnitSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it("rejects a session_id that is not a valid UUID", () => {
    const result = WorkUnitSchema.safeParse(validWorkUnit({ session_id: "not-a-uuid" }));
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key (.strict())", () => {
    const result = WorkUnitSchema.safeParse({ ...validWorkUnit(), unexpectedField: "nope" });
    expect(result.success).toBe(false);
  });

  it("rejects an attemptStatus outside the closed WorkUnitAttemptStatus union", () => {
    const result = WorkUnitSchema.safeParse(validWorkUnit({ attemptStatus: "archived" }));
    expect(result.success).toBe(false);
  });

  it("accepts every WorkUnitAttemptStatus member (6, reused union)", () => {
    expect(WORK_UNIT_ATTEMPT_STATUSES.length).toBe(6);
    for (const status of WORK_UNIT_ATTEMPT_STATUSES) {
      const result = WorkUnitSchema.safeParse(validWorkUnit({ attemptStatus: status }));
      expect(result.success).toBe(true);
    }
  });

  it("round-trips through JSON.stringify/JSON.parse deep-equal, with session_id present", () => {
    const original = WorkUnitSchema.parse(
      validWorkUnit({ session_id: SESSION_ID, attemptStatus: "dispatched" }),
    );
    const revived = WorkUnitSchema.parse(JSON.parse(JSON.stringify(original)) as unknown);
    expect(revived).toEqual(original);
  });

  it("round-trips through JSON.stringify/JSON.parse deep-equal, without session_id", () => {
    const original = WorkUnitSchema.parse(validWorkUnit());
    const revived = WorkUnitSchema.parse(JSON.parse(JSON.stringify(original)) as unknown);
    expect(revived).toEqual(original);
  });
});
