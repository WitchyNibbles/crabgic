import { describe, expect, it } from "vitest";
import { buildAuthorizationEnvelope } from "@crabgic/testkit";
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
      spec: {
        schemaVersion: 1,
        id: "aaaaaaaa-0000-4000-8000-00000000000f",
        taskId: "fixture-task",
        requirements: [
          {
            requirementId: "fixture-requirement",
            acceptanceCriteria: ["Objective observably met."],
          },
        ],
        doneCriteria: ["A named test demonstrates it."],
        testsFirst: true,
        permittedInterfaces: [],
      },
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
      spec: {
        schemaVersion: 1,
        id: "aaaaaaaa-0000-4000-8000-00000000000f",
        taskId: "fixture-task",
        requirements: [
          {
            requirementId: "fixture-requirement",
            acceptanceCriteria: ["Objective observably met."],
          },
        ],
        doneCriteria: ["A named test demonstrates it."],
        testsFirst: true,
        permittedInterfaces: [],
      },
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
      spec: {
        schemaVersion: 1,
        id: "aaaaaaaa-0000-4000-8000-00000000000f",
        taskId: "fixture-task",
        requirements: [
          {
            requirementId: "fixture-requirement",
            acceptanceCriteria: ["Objective observably met."],
          },
        ],
        doneCriteria: ["A named test demonstrates it."],
        testsFirst: true,
        permittedInterfaces: [],
      },
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
        spec: {
          schemaVersion: 1,
          id: "aaaaaaaa-0000-4000-8000-00000000000f",
          taskId: "fixture-task",
          requirements: [
            {
              requirementId: "fixture-requirement",
              acceptanceCriteria: ["Objective observably met."],
            },
          ],
          doneCriteria: ["A named test demonstrates it."],
          testsFirst: true,
          permittedInterfaces: [],
        },
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
        spec: {
          schemaVersion: 1,
          id: "aaaaaaaa-0000-4000-8000-00000000000f",
          taskId: "fixture-task",
          requirements: [
            {
              requirementId: "fixture-requirement",
              acceptanceCriteria: ["Objective observably met."],
            },
          ],
          doneCriteria: ["A named test demonstrates it."],
          testsFirst: true,
          permittedInterfaces: [],
        },
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
        spec: {
          schemaVersion: 1,
          id: "aaaaaaaa-0000-4000-8000-00000000000f",
          taskId: "fixture-task",
          requirements: [
            {
              requirementId: "fixture-requirement",
              acceptanceCriteria: ["Objective observably met."],
            },
          ],
          doneCriteria: ["A named test demonstrates it."],
          testsFirst: true,
          permittedInterfaces: [],
        },
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
        spec: {
          schemaVersion: 1,
          id: "aaaaaaaa-0000-4000-8000-00000000000f",
          taskId: "fixture-task",
          requirements: [
            {
              requirementId: "fixture-requirement",
              acceptanceCriteria: ["Objective observably met."],
            },
          ],
          doneCriteria: ["A named test demonstrates it."],
          testsFirst: true,
          permittedInterfaces: [],
        },
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

describe("the spec reaches the packet", () => {
  it("passes the CALLER's spec through, never a substitute", () => {
    // This test exists because the opposite nearly shipped. A scripted edit
    // inserted a hardcoded fixture spec into the builder's parse object, above
    // `spec: options.spec`, so every packet would have carried placeholder
    // acceptance criteria to a real worker. `tsc` was happy, every existing test
    // was happy, and it was caught by reading the diff rather than by running
    // anything -- so the property is asserted here now.
    const distinctive = {
      schemaVersion: 1 as const,
      id: "aaaaaaaa-0000-4000-8000-00000000000e",
      taskId: "caller-supplied-task",
      requirements: [
        {
          requirementId: "caller-supplied-requirement",
          acceptanceCriteria: ["This exact sentence must survive into the packet."],
        },
      ],
      doneCriteria: ["A named test demonstrates it."],
      testsFirst: true as const,
      permittedInterfaces: [],
    };
    const { packet } = buildTaskPacket({
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      workUnitId: "aaaaaaaa-0000-4000-8000-000000000002",
      requirementIds: [],
      spec: distinctive,
      objective: "Check the spec survives the builder.",
      baseObjectId: BASE_OBJECT_ID,
      ownedPaths: ["packages/example/src/"],
      resourceLimits: { maxTurns: 20 },
      resultSchema: {},
      envelope: envelope(),
    });
    expect(packet.spec.taskId).toBe("caller-supplied-task");
    expect(packet.spec.requirements[0]?.acceptanceCriteria).toEqual([
      "This exact sentence must survive into the packet.",
    ]);
  });
});
