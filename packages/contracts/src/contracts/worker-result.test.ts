import { describe, expect, it } from "vitest";
import { WorkerResultSchema } from "./worker-result.js";
import { WORK_UNIT_ATTEMPT_STATUS_TERMINALS } from "../state-machines/work-unit-attempt-status.js";

const ID = "11111111-1111-4111-8111-111111111111";
const WORK_UNIT_ID = "22222222-2222-4222-8222-222222222222";

function validWorkerResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: ID,
    workUnitId: WORK_UNIT_ID,
    outcome: "succeeded",
    summary: "Implemented the gateway MCP tool registry and passed all gates.",
    diagnostics: [],
    usage: { turnsUsed: 12, totalCostUsd: 0.42 },
    ...overrides,
  };
}

describe("WorkerResultSchema", () => {
  it("parses a fully-valid fixture", () => {
    const result = WorkerResultSchema.safeParse(validWorkerResult());
    expect(result.success).toBe(true);
  });

  it("parses a valid fixture with usage.totalCostUsd omitted (informational-only, §5.7)", () => {
    const fixture = validWorkerResult();
    const usage = fixture.usage as Record<string, unknown>;
    delete usage.totalCostUsd;
    const result = WorkerResultSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid-shape fixture (missing required summary)", () => {
    const fixture = validWorkerResult();
    delete fixture.summary;
    const result = WorkerResultSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key (.strict())", () => {
    const result = WorkerResultSchema.safeParse({
      ...validWorkerResult(),
      unexpectedField: "nope",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an outcome outside the reused terminal-status union", () => {
    const result = WorkerResultSchema.safeParse(validWorkerResult({ outcome: "pending" }));
    expect(result.success).toBe(false);
  });

  it("accepts every reused terminal WorkUnitAttemptStatus member as outcome (3: succeeded/failed/cancelled)", () => {
    expect(WORK_UNIT_ATTEMPT_STATUS_TERMINALS.length).toBe(3);
    for (const outcome of WORK_UNIT_ATTEMPT_STATUS_TERMINALS) {
      const result = WorkerResultSchema.safeParse(validWorkerResult({ outcome }));
      expect(result.success).toBe(true);
    }
  });

  it("round-trips through JSON.stringify/JSON.parse deep-equal", () => {
    const original = WorkerResultSchema.parse(
      validWorkerResult({ diagnostics: ["schema-violation: missing field 'summary'"] }),
    );
    const revived = WorkerResultSchema.parse(JSON.parse(JSON.stringify(original)) as unknown);
    expect(revived).toEqual(original);
  });
});
