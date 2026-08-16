import { describe, expect, it } from "vitest";
import type { EngineResultEvent } from "@crabgic/engine-core";
import { validateWorkerResult } from "./worker-result-validation.js";

function resultEvent(overrides: Partial<EngineResultEvent> = {}): EngineResultEvent {
  return {
    type: "result",
    sessionId: "s1",
    subtype: "success",
    isError: false,
    permissionDenials: [],
    ...overrides,
  };
}

const WORK_UNIT_ID = "11111111-1111-4111-8111-111111111111";

describe("validateWorkerResult", () => {
  it("valid: a well-formed structuredOutput parses successfully", () => {
    // The AUTHORED subset — what the published `outputFormat` schema permits
    // a worker to emit. Handing the validator a full `WorkerResult` would test
    // a document no real worker can produce.
    const workerResult = { outcome: "succeeded", summary: "did it", diagnostics: [] };
    const validation = validateWorkerResult(
      resultEvent({ structuredOutput: workerResult, turnsUsed: 3, totalCostUsd: 0.05 }),
      WORK_UNIT_ID,
    );
    expect(validation.kind).toBe("valid");
    if (validation.kind === "valid") {
      expect(validation.result.outcome).toBe("succeeded");
      expect(validation.usage).toEqual({ turnsUsed: 3, totalCostUsd: 0.05 });
    }
  });

  it("schemaViolation reason 'retriesExhausted' — checked first, unconditionally", () => {
    // The AUTHORED subset — what the published `outputFormat` schema permits
    // a worker to emit. Handing the validator a full `WorkerResult` would test
    // a document no real worker can produce.
    const workerResult = { outcome: "succeeded", summary: "did it", diagnostics: [] };
    const validation = validateWorkerResult(
      resultEvent({
        subtype: "error_max_structured_output_retries",
        structuredOutput: workerResult,
      }),
      WORK_UNIT_ID,
    );
    expect(validation).toMatchObject({ kind: "schemaViolation", reason: "retriesExhausted" });
  });

  it("schemaViolation reason 'absent' — no structuredOutput field at all", () => {
    const validation = validateWorkerResult(resultEvent(), WORK_UNIT_ID);
    expect(validation).toMatchObject({ kind: "schemaViolation", reason: "absent" });
  });

  it("schemaViolation reason 'invalid' — structuredOutput present but fails WorkerResultSchema", () => {
    const validation = validateWorkerResult(
      resultEvent({ structuredOutput: { garbage: true } }),
      WORK_UNIT_ID,
    );
    expect(validation.kind).toBe("schemaViolation");
    if (validation.kind === "schemaViolation") {
      expect(validation.reason).toBe("invalid");
      expect(validation.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it("valid result omits usage fields entirely when the engine result carried none", () => {
    // The AUTHORED subset — what the published `outputFormat` schema permits
    // a worker to emit. Handing the validator a full `WorkerResult` would test
    // a document no real worker can produce.
    const workerResult = { outcome: "succeeded", summary: "did it", diagnostics: [] };
    const validation = validateWorkerResult(
      resultEvent({ structuredOutput: workerResult }),
      WORK_UNIT_ID,
    );
    expect(validation.kind).toBe("valid");
    if (validation.kind === "valid") {
      expect(validation.usage).toEqual({});
    }
  });
});
