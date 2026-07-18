import { describe, expect, it } from "vitest";
import {
  ENGINE_EVENT_TYPES,
  ENGINE_EVENT_TYPE_DESCRIPTIONS,
  type EngineEvent,
  type EngineLimitSignalEvent,
  type RateLimitType,
} from "./engine-event.js";

/**
 * `EngineEvent` tests (roadmap/03-envelope-compiler-engine-adapter.md work
 * item 1; §Test plan "EngineEvent exhaustiveness test"). Each variant's
 * payload shape is grounded in a specific docs/engine-baseline.md section,
 * cited per test below.
 */
describe("EngineEvent — exhaustiveness (roadmap/03 work item 1 failing-first fixture)", () => {
  it("has exactly the six variants init | assistant | toolUse | result | retry | limitSignal, in order", () => {
    expect(ENGINE_EVENT_TYPES).toEqual([
      "init",
      "assistant",
      "toolUse",
      "result",
      "retry",
      "limitSignal",
    ]);
  });

  it("has exactly six variants (count)", () => {
    expect(ENGINE_EVENT_TYPES.length).toBe(6);
  });

  it("the exhaustiveness descriptor covers exactly the six declared variants, one description each", () => {
    const descriptorKeys = Object.keys(ENGINE_EVENT_TYPE_DESCRIPTIONS).sort();
    expect(descriptorKeys).toEqual([...ENGINE_EVENT_TYPES].sort());
    for (const variantType of ENGINE_EVENT_TYPES) {
      expect(typeof ENGINE_EVENT_TYPE_DESCRIPTIONS[variantType]).toBe("string");
      expect(ENGINE_EVENT_TYPE_DESCRIPTIONS[variantType].length).toBeGreaterThan(0);
    }
  });
});

describe("EngineEvent — variant payload shapes, grounded in docs/engine-baseline.md", () => {
  it("init: sessionId/model/cwd/tools/mcpServers (baseline §2 hermeticity mcp_servers=[]; §4.4 tool catalog; §7 session_id)", () => {
    const event: EngineEvent = {
      type: "init",
      sessionId: "s1",
      model: "sonnet",
      cwd: "/worktree",
      tools: ["Bash", "Edit", "Task"],
      mcpServers: ["example-gateway"],
    };
    expect(event.type).toBe("init");
  });

  it("assistant: sessionId/text (baseline §2, 'final reply exactly \"DONE\"'; §5, model's plain-text decline)", () => {
    const event: EngineEvent = { type: "assistant", sessionId: "s1", text: "DONE" };
    expect(event.text).toBe("DONE");
  });

  it("toolUse: toolUseId/toolName/toolInput/toolResult (baseline §3 tool_use/tool_result; §6 ENOENT-masking shape)", () => {
    const event: EngineEvent = {
      type: "toolUse",
      sessionId: "s1",
      toolUseId: "tu1",
      toolName: "Bash",
      toolInput: { command: "cat /home/user/.ssh/id_rsa" },
      toolResult: "cat: /home/user/.ssh/id_rsa: No such file or directory",
    };
    expect(event.toolResult).toContain("No such file or directory");
  });

  it("toolUse: toolResult is optional (a call may still be in flight)", () => {
    const event: EngineEvent = {
      type: "toolUse",
      sessionId: "s1",
      toolUseId: "tu2",
      toolName: "Read",
      toolInput: {},
    };
    expect(event.toolResult).toBeUndefined();
  });

  it("result: subtype/isError/structuredOutput/totalCostUsd/turnsUsed/permissionDenials (baseline §3 permission_denials; §4.4; §5; §7)", () => {
    const event: EngineEvent = {
      type: "result",
      sessionId: "s1",
      subtype: "success",
      isError: false,
      structuredOutput: { answer: "hello", count: 3 },
      totalCostUsd: 0.12,
      turnsUsed: 4,
      permissionDenials: [{ toolName: "Write", toolInput: {} }],
    };
    expect(event.permissionDenials).toHaveLength(1);
  });

  it("result: structuredOutput/totalCostUsd/turnsUsed are optional (baseline §5's observed success-with-no-structured-output shape)", () => {
    const event: EngineEvent = {
      type: "result",
      sessionId: "s1",
      subtype: "success",
      isError: false,
      permissionDenials: [],
    };
    expect(event.structuredOutput).toBeUndefined();
  });

  it("retry: subtype is always 'api_retry' (baseline §Full verdict tally, ratelimit row: SDKAPIRetryMessage typed shape)", () => {
    const event: EngineEvent = { type: "retry", sessionId: "s1", subtype: "api_retry" };
    expect(event.subtype).toBe("api_retry");
  });

  it("limitSignal: matches baseline §8's exact recorded rate_limit_info schema (allowed_warning sample)", () => {
    const event: EngineLimitSignalEvent = {
      type: "limitSignal",
      sessionId: "s1",
      status: "allowed_warning",
      resetsAt: 1784135400,
      rateLimitType: "five_hour",
      utilization: 0.96,
      surpassedThreshold: 0.9,
      isUsingOverage: false,
    };
    expect(event.status).toBe("allowed_warning");
    expect(event.resetsAt).toBe(1784135400);
  });

  it("limitSignal: accepts 'rejected' status and 'credits_required' errorCode (SDK-typed; baseline §8's UNRESOLVED exhausted variant)", () => {
    const event: EngineLimitSignalEvent = {
      type: "limitSignal",
      sessionId: "s1",
      status: "rejected",
      resetsAt: 1784135400,
      errorCode: "credits_required",
    };
    expect(event.status).toBe("rejected");
    expect(event.errorCode).toBe("credits_required");
  });

  it("limitSignal: accepts every baseline §8-documented rateLimitType member", () => {
    const types: readonly RateLimitType[] = [
      "five_hour",
      "seven_day",
      "seven_day_opus",
      "seven_day_sonnet",
      "seven_day_overage_included",
      "overage",
    ];
    for (const rateLimitType of types) {
      const event: EngineLimitSignalEvent = {
        type: "limitSignal",
        sessionId: "s1",
        status: "allowed",
        resetsAt: 0,
        rateLimitType,
      };
      expect(event.rateLimitType).toBe(rateLimitType);
    }
  });
});
