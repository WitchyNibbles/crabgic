import { describe, expect, it } from "vitest";
import { buildAuthorizationEnvelope } from "@eo/testkit";
import { buildTaskPacket } from "./task-packet-builder.js";
import { PacketBudgetExceededError, PacketEnvelopeViolationError } from "./errors.js";
import { DEFAULT_PACKET_FIELD_BUDGETS } from "./budgets.js";

const BASE_OBJECT_ID = "0123456789abcdef0123456789abcdef01234567";

function envelope(overrides: Parameters<typeof buildAuthorizationEnvelope>[0] = {}) {
  return buildAuthorizationEnvelope({
    ownedPaths: ["packages/example/src/"],
    commands: ["npm run build", "npm run test"],
    ...overrides,
  });
}

describe("buildTaskPacket", () => {
  it("builds a schema-valid packet with derived command constraints, never storing lessonPreamble on the packet itself", () => {
    const { packet, lessonPreamble } = buildTaskPacket({
      id: "11111111-1111-4111-8111-111111111111",
      workUnitId: "22222222-2222-4222-8222-222222222222",
      requirementIds: [],
      objective: "Implement the thing.",
      baseObjectId: BASE_OBJECT_ID,
      ownedPaths: ["packages/example/src/"],
      resourceLimits: { maxTurns: 10 },
      resultSchema: {},
      envelope: envelope(),
      lessonPreamble: "Prior attempt failed because X; avoid Y this time.",
    });

    expect(packet.constraints).toEqual([
      "Allowed command: npm run build",
      "Allowed command: npm run test",
    ]);
    expect(lessonPreamble).toBe("Prior attempt failed because X; avoid Y this time.");
    expect(packet).not.toHaveProperty("lessonPreamble");
  });

  it("defaults lessonPreamble to undefined when not supplied", () => {
    const { lessonPreamble } = buildTaskPacket({
      id: "11111111-1111-4111-8111-111111111111",
      workUnitId: "22222222-2222-4222-8222-222222222222",
      requirementIds: [],
      objective: "Implement the thing.",
      baseObjectId: BASE_OBJECT_ID,
      ownedPaths: ["packages/example/src/"],
      resourceLimits: { maxTurns: 10 },
      resultSchema: {},
      envelope: envelope(),
    });
    expect(lessonPreamble).toBeUndefined();
  });

  it("restricts commands to a narrower allowedCommands set when supplied", () => {
    const { packet } = buildTaskPacket({
      id: "11111111-1111-4111-8111-111111111111",
      workUnitId: "22222222-2222-4222-8222-222222222222",
      requirementIds: [],
      objective: "Implement the thing.",
      baseObjectId: BASE_OBJECT_ID,
      ownedPaths: ["packages/example/src/"],
      allowedCommands: ["npm run test"],
      resourceLimits: { maxTurns: 10 },
      resultSchema: {},
      envelope: envelope(),
    });
    expect(packet.constraints).toEqual(["Allowed command: npm run test"]);
  });

  it("throws PacketEnvelopeViolationError when ownedPaths would be wider than the envelope", () => {
    expect(() =>
      buildTaskPacket({
        id: "11111111-1111-4111-8111-111111111111",
        workUnitId: "22222222-2222-4222-8222-222222222222",
        requirementIds: [],
        objective: "Implement the thing.",
        baseObjectId: BASE_OBJECT_ID,
        ownedPaths: ["packages/OTHER/src/"],
        resourceLimits: { maxTurns: 10 },
        resultSchema: {},
        envelope: envelope(),
      }),
    ).toThrow(PacketEnvelopeViolationError);
  });

  it("throws PacketEnvelopeViolationError when allowedCommands would be wider than the envelope", () => {
    expect(() =>
      buildTaskPacket({
        id: "11111111-1111-4111-8111-111111111111",
        workUnitId: "22222222-2222-4222-8222-222222222222",
        requirementIds: [],
        objective: "Implement the thing.",
        baseObjectId: BASE_OBJECT_ID,
        ownedPaths: ["packages/example/src/"],
        allowedCommands: ["rm -rf /"],
        resourceLimits: { maxTurns: 10 },
        resultSchema: {},
        envelope: envelope(),
      }),
    ).toThrow(PacketEnvelopeViolationError);
  });

  it("throws PacketBudgetExceededError when a field exceeds its budget, never silently truncating", () => {
    expect(() =>
      buildTaskPacket({
        id: "11111111-1111-4111-8111-111111111111",
        workUnitId: "22222222-2222-4222-8222-222222222222",
        requirementIds: [],
        objective: "x".repeat(DEFAULT_PACKET_FIELD_BUDGETS.objective + 1),
        baseObjectId: BASE_OBJECT_ID,
        ownedPaths: ["packages/example/src/"],
        resourceLimits: { maxTurns: 10 },
        resultSchema: {},
        envelope: envelope(),
      }),
    ).toThrow(PacketBudgetExceededError);
  });

  it("checks the envelope-subset invariant BEFORE the budget check", () => {
    // Both violations present at once — envelope violation must win (the
    // more fundamental authorization defect), proving check ordering.
    expect(() =>
      buildTaskPacket({
        id: "11111111-1111-4111-8111-111111111111",
        workUnitId: "22222222-2222-4222-8222-222222222222",
        requirementIds: [],
        objective: "x".repeat(DEFAULT_PACKET_FIELD_BUDGETS.objective + 1),
        baseObjectId: BASE_OBJECT_ID,
        ownedPaths: ["packages/OTHER/src/"],
        resourceLimits: { maxTurns: 10 },
        resultSchema: {},
        envelope: envelope(),
      }),
    ).toThrow(PacketEnvelopeViolationError);
  });
});
