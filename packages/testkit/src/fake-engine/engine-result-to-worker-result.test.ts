import { describe, expect, it } from "vitest";
import { IdSchema, WorkerResultSchema } from "@eo/contracts";
import type { EngineResultEvent } from "@eo/engine-core";
import { toWorkerResult } from "./engine-result-to-worker-result.js";

const ID = IdSchema.parse("11111111-1111-4111-8111-111111111111");
const WORK_UNIT_ID = IdSchema.parse("22222222-2222-4222-8222-222222222222");

describe("toWorkerResult", () => {
  it("maps a clean success result to outcome 'succeeded' with no diagnostics", () => {
    const event: EngineResultEvent = {
      type: "result",
      sessionId: "s1",
      subtype: "success",
      isError: false,
      permissionDenials: [],
      turnsUsed: 3,
      totalCostUsd: 0.01,
    };
    const result = toWorkerResult(event, ID, WORK_UNIT_ID);
    expect(result.outcome).toBe("succeeded");
    expect(result.diagnostics).toEqual([]);
    expect(() => WorkerResultSchema.parse(result)).not.toThrow();
  });

  it("maps a result with permission denials to outcome 'failed' with per-denial diagnostics", () => {
    const event: EngineResultEvent = {
      type: "result",
      sessionId: "s1",
      subtype: "success",
      isError: false,
      permissionDenials: [{ toolName: "Bash", toolInput: { command: "curl http://example.com" } }],
      turnsUsed: 1,
    };
    const result = toWorkerResult(event, ID, WORK_UNIT_ID);
    expect(result.outcome).toBe("failed");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toContain("Bash");
  });

  it("maps an isError result to outcome 'failed' even with no denials", () => {
    const event: EngineResultEvent = {
      type: "result",
      sessionId: "s1",
      subtype: "error",
      isError: true,
      permissionDenials: [],
    };
    const result = toWorkerResult(event, ID, WORK_UNIT_ID);
    expect(result.outcome).toBe("failed");
  });

  it("defaults turnsUsed to 0 when the event omits it", () => {
    const event: EngineResultEvent = {
      type: "result",
      sessionId: "s1",
      subtype: "success",
      isError: false,
      permissionDenials: [],
    };
    expect(toWorkerResult(event, ID, WORK_UNIT_ID).usage.turnsUsed).toBe(0);
  });
});
