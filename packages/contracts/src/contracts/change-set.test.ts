import { describe, expect, it } from "vitest";
import { ChangeSetSchema } from "./change-set.js";
import { RUN_LIFECYCLE_STATES } from "../state-machines/run-lifecycle.js";

const ID = "11111111-1111-4111-8111-111111111111";
const INTENT_CONTRACT_ID = "22222222-2222-4222-8222-222222222222";
const ENVELOPE_ID = "33333333-3333-4333-8333-333333333333";
const MANIFEST_ID = "44444444-4444-4444-8444-444444444444";
const PROVISIONAL_PERF_ID = "55555555-5555-4555-8555-555555555555";
const ENFORCED_PERF_ID = "66666666-6666-4666-8666-666666666666";
const WORK_UNIT_A = "77777777-7777-4777-8777-777777777777";
const WORK_UNIT_B = "88888888-8888-4888-8888-888888888888";

function validChangeSet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: ID,
    state: "draft",
    intentContractId: INTENT_CONTRACT_ID,
    authorizationEnvelopeId: ENVELOPE_ID,
    capabilityManifestId: MANIFEST_ID,
    provisionalPerformanceContractId: PROVISIONAL_PERF_ID,
    integrationOrder: [WORK_UNIT_A, WORK_UNIT_B],
    rollbackStrategy: "Revert the integration branch to the frozen base object ID.",
    createdAt: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("ChangeSetSchema", () => {
  it("parses a fully-valid fixture", () => {
    const result = ChangeSetSchema.safeParse(validChangeSet());
    expect(result.success).toBe(true);
  });

  it("parses a valid fixture that also carries the optional enforcedPerformanceContractId", () => {
    const result = ChangeSetSchema.safeParse(
      validChangeSet({ enforcedPerformanceContractId: ENFORCED_PERF_ID }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects an invalid-shape fixture (missing required intentContractId)", () => {
    const fixture = validChangeSet();
    delete fixture.intentContractId;
    const result = ChangeSetSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID id", () => {
    const result = ChangeSetSchema.safeParse(validChangeSet({ id: "not-a-uuid" }));
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key (.strict())", () => {
    const result = ChangeSetSchema.safeParse({ ...validChangeSet(), unexpectedField: "nope" });
    expect(result.success).toBe(false);
  });

  it("rejects a state outside the run-lifecycle closed union", () => {
    const result = ChangeSetSchema.safeParse(validChangeSet({ state: "archived" }));
    expect(result.success).toBe(false);
  });

  it("accepts every run-lifecycle state as ChangeSet.state (11 members, reused union)", () => {
    expect(RUN_LIFECYCLE_STATES.length).toBe(11);
    for (const state of RUN_LIFECYCLE_STATES) {
      const result = ChangeSetSchema.safeParse(validChangeSet({ state }));
      expect(result.success).toBe(true);
    }
  });

  it("round-trips through JSON.stringify/JSON.parse deep-equal", () => {
    const original = ChangeSetSchema.parse(
      validChangeSet({ state: "running", enforcedPerformanceContractId: ENFORCED_PERF_ID }),
    );
    const revived = ChangeSetSchema.parse(JSON.parse(JSON.stringify(original)) as unknown);
    expect(revived).toEqual(original);
  });
});
