import { describe, expect, it } from "vitest";
import { RemoteMutationPlanSchema } from "./remote-mutation-plan.js";

const validPlan = {
  schemaVersion: 1,
  id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
  externalConnectionId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  tenant: "acme-corp",
  canonicalTarget: "jira:PROJ-123",
  action: "issue.transition",
  requiredCapabilityFlags: ["closing transitions"],
  redactedDiff: "status: In Progress -> Done",
  desiredStateHash: "sha256:9f3e...",
  idempotencyKey: "run-42:work-unit-7:issue-transition-1",
  expectedRemoteRevision: "rev-17",
  impactClass: "reversible",
  rollbackClass: "version-checked-restore",
  envelopeId: "2c8e6b3a-2f8b-4b2a-9d7e-2f6a8e3b9c1d",
};

describe("RemoteMutationPlanSchema — valid fixture", () => {
  it("parses a fully-valid fixture (roadmap/16 §In scope, Mutation pipeline bullet)", () => {
    expect(RemoteMutationPlanSchema.safeParse(validPlan).success).toBe(true);
  });

  it("accepts a create-action plan with no expectedRemoteRevision and no capability flags", () => {
    const { expectedRemoteRevision: _rev, requiredCapabilityFlags: _flags, ...rest } = validPlan;
    const create = { ...rest, action: "issue.create" };
    expect(RemoteMutationPlanSchema.safeParse(create).success).toBe(true);
  });

  it("accepts multiple required capability flags (roadmap/20: bulk-touching mutations may require more than one)", () => {
    const multi = {
      ...validPlan,
      requiredCapabilityFlags: ["bulk mutations", "closing transitions"],
    };
    expect(RemoteMutationPlanSchema.safeParse(multi).success).toBe(true);
  });
});

describe("RemoteMutationPlanSchema — invalid-shape rejection", () => {
  it("rejects a missing schemaVersion", () => {
    const { schemaVersion: _schemaVersion, ...rest } = validPlan;
    expect(RemoteMutationPlanSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a non-uuid envelopeId", () => {
    expect(
      RemoteMutationPlanSchema.safeParse({ ...validPlan, envelopeId: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("rejects a capability flag outside HighImpactCapabilityFlag's 11-member union", () => {
    expect(
      RemoteMutationPlanSchema.safeParse({
        ...validPlan,
        requiredCapabilityFlags: ["made up capability"],
      }).success,
    ).toBe(false);
  });

  it("rejects an empty idempotencyKey", () => {
    expect(RemoteMutationPlanSchema.safeParse({ ...validPlan, idempotencyKey: "" }).success).toBe(
      false,
    );
  });

  it("rejects an empty redactedDiff", () => {
    expect(RemoteMutationPlanSchema.safeParse({ ...validPlan, redactedDiff: "" }).success).toBe(
      false,
    );
  });
});

describe("RemoteMutationPlanSchema — unknown-key rejection (.strict())", () => {
  it("rejects an unknown top-level key", () => {
    expect(RemoteMutationPlanSchema.safeParse({ ...validPlan, unexpected: "field" }).success).toBe(
      false,
    );
  });

  it("rejects a raw provider-body-shaped key masquerading as the redacted diff", () => {
    expect(
      RemoteMutationPlanSchema.safeParse({ ...validPlan, rawProviderBody: { leak: true } }).success,
    ).toBe(false);
  });
});

describe("RemoteMutationPlanSchema — round-trip", () => {
  it("parse -> JSON.stringify -> JSON.parse -> parse yields a deep-equal output", () => {
    const first = RemoteMutationPlanSchema.parse(validPlan);
    const roundTripped = RemoteMutationPlanSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped).toStrictEqual(first);
  });
});
