/**
 * roadmap/06-claude-engine-adapter.md work item 4 — the valid path and
 * usage accounting for `validateWorkerResult`. The three schema-violation
 * reasons live in `structured-output-violation.test.ts` (the exit-criterion
 * file name).
 */
import { describe, expect, it } from "vitest";
import type { EngineResultEvent } from "@eo/engine-core";
import { validateWorkerResult } from "./result-validation.js";

const VALID_WORKER_RESULT = {
  schemaVersion: 1,
  id: "11111111-1111-4111-8111-111111111111",
  workUnitId: "22222222-2222-4222-8222-222222222222",
  outcome: "succeeded",
  summary: "did the thing",
  diagnostics: [],
  usage: { turnsUsed: 3 },
};

function buildResultEvent(overrides: Partial<EngineResultEvent> = {}): EngineResultEvent {
  return {
    type: "result",
    sessionId: "session-1",
    subtype: "success",
    isError: false,
    permissionDenials: [],
    ...overrides,
  };
}

describe("validateWorkerResult — valid path", () => {
  it("returns kind 'valid' with the parsed WorkerResult when structuredOutput passes the schema", () => {
    const validation = validateWorkerResult(
      buildResultEvent({ structuredOutput: VALID_WORKER_RESULT }),
    );
    expect(validation.kind).toBe("valid");
    if (validation.kind === "valid") {
      expect(validation.result.id).toBe(VALID_WORKER_RESULT.id);
      expect(validation.result.outcome).toBe("succeeded");
    }
  });

  it("passes through turnsUsed and totalCostUsd from the EngineResultEvent's usage fields", () => {
    const validation = validateWorkerResult(
      buildResultEvent({ structuredOutput: VALID_WORKER_RESULT, turnsUsed: 5, totalCostUsd: 0.42 }),
    );
    expect(validation.kind).toBe("valid");
    if (validation.kind === "valid") {
      expect(validation.usage).toEqual({ turnsUsed: 5, totalCostUsd: 0.42 });
    }
  });

  it("omits usage keys entirely (never as an explicit undefined) when the EngineResultEvent carries no usage fields", () => {
    const validation = validateWorkerResult(
      buildResultEvent({ structuredOutput: VALID_WORKER_RESULT }),
    );
    expect(validation.kind).toBe("valid");
    if (validation.kind === "valid") {
      expect(validation.usage).toEqual({});
      expect(Object.hasOwn(validation.usage, "turnsUsed")).toBe(false);
      expect(Object.hasOwn(validation.usage, "totalCostUsd")).toBe(false);
    }
  });

  it("passes through only turnsUsed when totalCostUsd is absent", () => {
    const validation = validateWorkerResult(
      buildResultEvent({ structuredOutput: VALID_WORKER_RESULT, turnsUsed: 7 }),
    );
    expect(validation.kind).toBe("valid");
    if (validation.kind === "valid") {
      expect(validation.usage).toEqual({ turnsUsed: 7 });
    }
  });

  it("outcome 'failed'/'cancelled' terminal results still validate as 'valid' — outcome is self-reported by the worker, independent of isError", () => {
    const failedResult = { ...VALID_WORKER_RESULT, outcome: "failed", diagnostics: ["it broke"] };
    const validation = validateWorkerResult(
      buildResultEvent({ structuredOutput: failedResult, isError: true }),
    );
    expect(validation.kind).toBe("valid");
    if (validation.kind === "valid") {
      expect(validation.result.outcome).toBe("failed");
    }
  });
});
