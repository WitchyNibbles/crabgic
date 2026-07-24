import { describe, expect, it } from "vitest";
import { buildWorkerResult } from "@eo/testkit";
import type { EngineResultEvent } from "@eo/engine-core";
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

describe("validateWorkerResult", () => {
  it("valid: a well-formed structuredOutput parses successfully", () => {
    const workerResult = buildWorkerResult({ outcome: "succeeded" });
    const validation = validateWorkerResult(
      resultEvent({ structuredOutput: workerResult, turnsUsed: 3, totalCostUsd: 0.05 }),
    );
    expect(validation.kind).toBe("valid");
    if (validation.kind === "valid") {
      expect(validation.result.outcome).toBe("succeeded");
      expect(validation.usage).toEqual({ turnsUsed: 3, totalCostUsd: 0.05 });
    }
  });

  it("schemaViolation reason 'retriesExhausted' — checked first, unconditionally", () => {
    const workerResult = buildWorkerResult({ outcome: "succeeded" });
    const validation = validateWorkerResult(
      resultEvent({
        subtype: "error_max_structured_output_retries",
        structuredOutput: workerResult,
      }),
    );
    expect(validation).toMatchObject({ kind: "schemaViolation", reason: "retriesExhausted" });
  });

  it("schemaViolation reason 'absent' — no structuredOutput field at all", () => {
    const validation = validateWorkerResult(resultEvent());
    expect(validation).toMatchObject({ kind: "schemaViolation", reason: "absent" });
  });

  it("schemaViolation reason 'invalid' — structuredOutput present but fails WorkerResultSchema", () => {
    const validation = validateWorkerResult(resultEvent({ structuredOutput: { garbage: true } }));
    expect(validation.kind).toBe("schemaViolation");
    if (validation.kind === "schemaViolation") {
      expect(validation.reason).toBe("invalid");
      expect(validation.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it("valid result omits usage fields entirely when the engine result carried none", () => {
    const workerResult = buildWorkerResult({ outcome: "succeeded" });
    const validation = validateWorkerResult(resultEvent({ structuredOutput: workerResult }));
    expect(validation.kind).toBe("valid");
    if (validation.kind === "valid") {
      expect(validation.usage).toEqual({});
    }
  });
});
