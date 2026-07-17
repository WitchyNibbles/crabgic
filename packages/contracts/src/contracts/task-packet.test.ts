import { describe, expect, it } from "vitest";
import { TaskPacketSchema } from "./task-packet.js";

const ID = "11111111-1111-4111-8111-111111111111";
const WORK_UNIT_ID = "22222222-2222-4222-8222-222222222222";
const REQUIREMENT_ID = "33333333-3333-4333-8333-333333333333";

function validTaskPacket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: ID,
    workUnitId: WORK_UNIT_ID,
    requirementIds: [REQUIREMENT_ID],
    objective: "Implement the gateway MCP tool registry.",
    nonGoals: ["Do not implement provider-specific connectors."],
    baseObjectId: "a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d",
    relevantInterfaces: ["packages/gateway/src/registry.ts"],
    ownedPaths: ["packages/gateway/src/**"],
    constraints: ["No network egress outside the gateway."],
    resourceLimits: { maxTurns: 80, maxBudgetUsd: 8 },
    gates: ["tdd", "coverage"],
    resultSchema: { type: "object", properties: {} },
    ...overrides,
  };
}

describe("TaskPacketSchema", () => {
  it("parses a fully-valid fixture", () => {
    const result = TaskPacketSchema.safeParse(validTaskPacket());
    expect(result.success).toBe(true);
  });

  it("parses a valid fixture with resourceLimits.maxBudgetUsd omitted (informational-only, §5.7)", () => {
    const fixture = validTaskPacket();
    const resourceLimits = fixture.resourceLimits as Record<string, unknown>;
    delete resourceLimits.maxBudgetUsd;
    const result = TaskPacketSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid-shape fixture (missing required objective)", () => {
    const fixture = validTaskPacket();
    delete fixture.objective;
    const result = TaskPacketSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive maxTurns", () => {
    const result = TaskPacketSchema.safeParse(validTaskPacket({ resourceLimits: { maxTurns: 0 } }));
    expect(result.success).toBe(false);
  });

  it("rejects an unknown top-level key (.strict())", () => {
    const result = TaskPacketSchema.safeParse({ ...validTaskPacket(), unexpectedField: "nope" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key inside resourceLimits (.strict())", () => {
    const result = TaskPacketSchema.safeParse(
      validTaskPacket({ resourceLimits: { maxTurns: 80, extra: true } }),
    );
    expect(result.success).toBe(false);
  });

  it("round-trips through JSON.stringify/JSON.parse deep-equal", () => {
    const original = TaskPacketSchema.parse(validTaskPacket());
    const revived = TaskPacketSchema.parse(JSON.parse(JSON.stringify(original)) as unknown);
    expect(revived).toEqual(original);
  });
});
