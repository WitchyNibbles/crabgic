import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  EventNormalizationError,
  normalizeSdkMessage,
  normalizeSdkStream,
} from "./event-normalizer.js";

/**
 * Fixture-driven tests (roadmap/06-claude-engine-adapter.md work item 2,
 * §Test plan) against the committed phase-00 fixtures at `spikes/fixtures/`
 * (docs/engine-baseline.md §12's fixture index) — never a hand-copied
 * restatement of their contents, so drift in the committed evidence would
 * break these tests.
 */
function fixtureUrl(name: string): URL {
  return new URL(`../../../spikes/fixtures/${name}`, import.meta.url);
}

function loadJsonlMessages(name: string): readonly SDKMessage[] {
  const raw = readFileSync(fixtureUrl(name), "utf8");
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as SDKMessage);
}

function loadJsonRuns(name: string): Readonly<Record<string, readonly SDKMessage[]>> {
  const raw = readFileSync(fixtureUrl(name), "utf8");
  return JSON.parse(raw) as Record<string, readonly SDKMessage[]>;
}

/** `06-sessions.raw.sanitized.json`'s CLI-transport runs embed their stream as an ndjson `stdout` string, not a message array. */
function loadCliStreamRuns(name: string): Readonly<Record<string, readonly SDKMessage[]>> {
  const raw = readFileSync(fixtureUrl(name), "utf8");
  const parsed = JSON.parse(raw) as Record<string, { readonly stdout?: string }>;
  const result: Record<string, SDKMessage[]> = {};
  for (const [key, run] of Object.entries(parsed)) {
    const stdout = run.stdout;
    result[key] =
      typeof stdout === "string" && stdout.trim().length > 0
        ? stdout
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as SDKMessage)
        : [];
  }
  return result;
}

async function* toAsyncIterable<T>(items: readonly T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of stream) {
    out.push(item);
  }
  return out;
}

function messageSubtype(message: SDKMessage): string | undefined {
  return (message as { readonly subtype?: string }).subtype;
}

const HERMETICITY_MESSAGES = loadJsonlMessages("02-hermeticity.transcript.sanitized.jsonl");

describe("normalizeSdkMessage — roadmap/06 work item 2's first failing test (docs/engine-baseline.md §8)", () => {
  it("normalizes the committed rate_limit_event fixture to a typed limitSignal event", () => {
    const rateLimitMessage = HERMETICITY_MESSAGES.find((m) => m.type === "rate_limit_event");
    expect(rateLimitMessage).toBeDefined();
    const event = normalizeSdkMessage(rateLimitMessage as SDKMessage, "fallback-session");
    expect(event).toEqual({
      type: "limitSignal",
      sessionId: "10087dbb-f66c-4359-a40f-5a5ebb947f6a",
      status: "allowed_warning",
      resetsAt: 1784135400,
      rateLimitType: "five_hour",
      utilization: 0.96,
      isUsingOverage: false,
      surpassedThreshold: 0.9,
    });
  });
});

describe("normalizeSdkMessage — every committed rate_limit_event sample across 02/03/04/05 (baseline §8: 16 total)", () => {
  function collectRateLimitMessages(): SDKMessage[] {
    const all: SDKMessage[] = [
      ...HERMETICITY_MESSAGES.filter((m) => m.type === "rate_limit_event"),
    ];
    for (const file of [
      "03-permissions.transcripts.sanitized.json",
      "04-sandbox.transcripts.sanitized.json",
      "05-structured-output.transcripts.sanitized.json",
    ]) {
      const runs = loadJsonRuns(file);
      for (const run of Object.values(runs)) {
        all.push(...run.filter((m) => m.type === "rate_limit_event"));
      }
    }
    return all;
  }

  it("has exactly 16 samples, each normalizing to a limitSignal event without throwing", () => {
    const rateLimitMessages = collectRateLimitMessages();
    expect(rateLimitMessages).toHaveLength(16);
    for (const message of rateLimitMessages) {
      expect(normalizeSdkMessage(message, "fallback")?.type).toBe("limitSignal");
    }
  });

  it("covers the allowed_warning utilization variants 0.96/0.98/0.99", () => {
    const utilizations = new Set<number>();
    for (const message of collectRateLimitMessages()) {
      const event = normalizeSdkMessage(message, "fallback");
      if (event?.type === "limitSignal" && event.utilization !== undefined) {
        utilizations.add(event.utilization);
      }
    }
    expect(utilizations).toEqual(new Set([0.96, 0.98, 0.99]));
  });

  it("covers the 'allowed' (non-warning) five_hour sample", () => {
    const sawAllowed = collectRateLimitMessages().some((message) => {
      const event = normalizeSdkMessage(message, "fallback");
      return event?.type === "limitSignal" && event.status === "allowed";
    });
    expect(sawAllowed).toBe(true);
  });
});

describe("normalizeSdkMessage — hand-built 'rejected' rate_limit_event (SDK-typed, unobserved live per baseline §8)", () => {
  it("normalizes a status:'rejected' sample to a typed limitSignal event", () => {
    const message = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: 1784999999, errorCode: "credits_required" },
      uuid: "22222222-2222-2222-2222-222222222222",
      session_id: "session-x",
    } as unknown as SDKMessage;
    const event = normalizeSdkMessage(message, "fallback");
    expect(event).toEqual({
      type: "limitSignal",
      sessionId: "session-x",
      status: "rejected",
      resetsAt: 1784999999,
      errorCode: "credits_required",
    });
  });
});

const BASELINE_LIMIT_ERROR_SAMPLE =
  "Agent terminated early due to an API error: You've hit your session limit · resets 2:10pm (Europe/Madrid)";

function assistantTextMessage(text: string, sessionId: string): SDKMessage {
  return {
    type: "assistant",
    message: {
      model: "claude-haiku-4-5-20251001",
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text }],
      stop_reason: null,
      stop_sequence: null,
      usage: {},
    },
    parent_tool_use_id: null,
    uuid: "33333333-3333-3333-3333-333333333333",
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function errorResultMessage(errorText: string, sessionId: string): SDKMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    num_turns: 1,
    total_cost_usd: 0,
    permission_denials: [],
    errors: [errorText],
    session_id: sessionId,
    uuid: "44444444-4444-4444-4444-444444444444",
  } as unknown as SDKMessage;
}

describe("normalizeSdkStream — error-string fallback synthesis is ENGINE-ORIGINATED only (Finding 6: prompt-injection resistance)", () => {
  it("does NOT synthesize a limitSignal for model-authored ASSISTANT text carrying the limit phrase", async () => {
    // A worker induced (prompt injection) to emit the limit phrase as
    // assistant prose must NOT synthesize a spurious rejected limitSignal.
    const events = await collect(
      normalizeSdkStream(
        toAsyncIterable([assistantTextMessage(BASELINE_LIMIT_ERROR_SAMPLE, "session-y")]),
        "fallback",
      ),
    );
    expect(events).toEqual([
      { type: "assistant", sessionId: "session-y", text: BASELINE_LIMIT_ERROR_SAMPLE },
    ]);
    expect(events.some((e) => e.type === "limitSignal")).toBe(false);
  });

  it("DOES synthesize a status:'rejected' limitSignal for an ENGINE error result carrying the fallback phrase", async () => {
    const events = await collect(
      normalizeSdkStream(
        toAsyncIterable([errorResultMessage(BASELINE_LIMIT_ERROR_SAMPLE, "session-e")]),
        "fallback",
      ),
    );
    expect(events.some((e) => e.type === "result")).toBe(true);
    expect(
      events.some((e) => e.type === "limitSignal" && e.status === "rejected" && e.resetsAt === 0),
    ).toBe(true);
  });

  it("does NOT synthesize a limitSignal for a benign engine error result", async () => {
    const events = await collect(
      normalizeSdkStream(
        toAsyncIterable([errorResultMessage("connection reset by peer", "session-e2")]),
        "fallback",
      ),
    );
    expect(events.some((e) => e.type === "limitSignal")).toBe(false);
  });

  it("does NOT synthesize a limitSignal for benign assistant text", async () => {
    const events = await collect(
      normalizeSdkStream(toAsyncIterable([assistantTextMessage("DONE", "session-z")]), "fallback"),
    );
    expect(events).toEqual([{ type: "assistant", sessionId: "session-z", text: "DONE" }]);
  });
});

describe("normalizeSdkMessage — init/assistant/toolUse/result/api_retry mappings (docs/engine-baseline.md §2, §5, §12)", () => {
  it("init: system/init → EngineInitEvent (sessionId/model/cwd/tools/mcpServers)", () => {
    const initMessage = HERMETICITY_MESSAGES.find(
      (m) => m.type === "system" && messageSubtype(m) === "init",
    );
    expect(initMessage).toBeDefined();
    const event = normalizeSdkMessage(initMessage as SDKMessage, "fallback");
    expect(event?.type).toBe("init");
    if (event?.type === "init") {
      expect(event.sessionId).toBe("10087dbb-f66c-4359-a40f-5a5ebb947f6a");
      expect(event.cwd).toBe("/tmp/crabgic-spike02-project-T2envz");
      expect(event.tools).toContain("Bash");
      expect(event.mcpServers).toEqual([]);
    }
  });

  it("assistant: concatenated text (baseline §2's final reply exactly 'DONE')", () => {
    const textEvent = HERMETICITY_MESSAGES.map((m) => normalizeSdkMessage(m, "fallback")).find(
      (e) => e?.type === "assistant",
    );
    expect(textEvent).toEqual({
      type: "assistant",
      sessionId: "10087dbb-f66c-4359-a40f-5a5ebb947f6a",
      text: "DONE",
    });
  });

  it("assistant: tool_use content block → toolUse event with no toolResult yet (pure per-message mapping)", () => {
    const toolUseEvent = HERMETICITY_MESSAGES.map((m) => normalizeSdkMessage(m, "fallback")).find(
      (e) => e?.type === "toolUse",
    );
    expect(toolUseEvent).toEqual({
      type: "toolUse",
      sessionId: "10087dbb-f66c-4359-a40f-5a5ebb947f6a",
      toolUseId: "toolu_01CYZ5Gtij91ebmb37LF7Beo",
      toolName: "Bash",
      toolInput: {
        command: "echo A=$EO_CHECK_A B=$EO_CHECK_B",
        description: "Output environment variables EO_CHECK_A and EO_CHECK_B",
      },
    });
  });

  it("result: subtype/isError/totalCostUsd/turnsUsed/permissionDenials", () => {
    const resultEvent = HERMETICITY_MESSAGES.map((m) => normalizeSdkMessage(m, "fallback")).find(
      (e) => e?.type === "result",
    );
    expect(resultEvent?.type).toBe("result");
    if (resultEvent?.type === "result") {
      expect(resultEvent.subtype).toBe("success");
      expect(resultEvent.isError).toBe(false);
      expect(resultEvent.turnsUsed).toBe(2);
      expect(resultEvent.permissionDenials).toEqual([]);
      expect(typeof resultEvent.totalCostUsd).toBe("number");
    }
  });

  it("api_retry: system/api_retry → EngineRetryEvent (baseline §12: WAIVED live capture, SDK-typed shape only)", () => {
    const retryMessage = {
      type: "system",
      subtype: "api_retry",
      attempt: 1,
      max_retries: 3,
      retry_delay_ms: 500,
      error_status: 529,
      error: "overloaded",
      uuid: "44444444-4444-4444-4444-444444444444",
      session_id: "session-retry",
    } as unknown as SDKMessage;
    expect(normalizeSdkMessage(retryMessage, "fallback")).toEqual({
      type: "retry",
      sessionId: "session-retry",
      subtype: "api_retry",
    });
  });
});

describe("normalizeSdkMessage — schema-violation fixture (docs/engine-baseline.md §5)", () => {
  const runs = loadJsonRuns("05-structured-output.transcripts.sanitized.json");

  it("subtype:'success' with structured_output ABSENT normalizes to a result event with structuredOutput undefined", () => {
    const resultMessage = runs["schema-violation"]?.find((m) => m.type === "result");
    expect(resultMessage).toBeDefined();
    const event = normalizeSdkMessage(resultMessage as SDKMessage, "fallback");
    expect(event?.type).toBe("result");
    if (event?.type === "result") {
      expect(event.subtype).toBe("success");
      expect(event.structuredOutput).toBeUndefined();
    }
  });

  it("happy-path fixture normalizes structured_output when present", () => {
    const resultMessage = runs["happy-path"]?.find((m) => m.type === "result");
    expect(resultMessage).toBeDefined();
    const event = normalizeSdkMessage(resultMessage as SDKMessage, "fallback");
    expect(event?.type).toBe("result");
    if (event?.type === "result") {
      expect(event.structuredOutput).toEqual({ answer: "hello", count: 3 });
    }
  });
});

describe("normalizeSdkMessage — permission_denials mapping (docs/engine-baseline.md §3)", () => {
  it("maps tool_name/tool_input to toolName/toolInput for a denied-call result", () => {
    const runs = loadJsonRuns("03-permissions.transcripts.sanitized.json");
    const resultMessage = runs["deny-wins-same-level"]?.find((m) => m.type === "result");
    expect(resultMessage).toBeDefined();
    const event = normalizeSdkMessage(resultMessage as SDKMessage, "fallback");
    expect(event?.type).toBe("result");
    if (event?.type === "result") {
      expect(event.permissionDenials).toEqual([
        {
          toolName: "Bash",
          toolInput: {
            command: "echo same-level-test",
            description: "Echo the text 'same-level-test'",
          },
        },
      ]);
    }
  });
});

describe("normalizeSdkMessage — unhandled member types → undefined, never a throw", () => {
  it("system/thinking_tokens (present in every fixture) normalizes to undefined", () => {
    const thinkingTokenMessages = HERMETICITY_MESSAGES.filter(
      (m) => m.type === "system" && messageSubtype(m) === "thinking_tokens",
    );
    expect(thinkingTokenMessages.length).toBeGreaterThan(0);
    for (const message of thinkingTokenMessages) {
      expect(normalizeSdkMessage(message, "fallback")).toBeUndefined();
    }
  });

  it("system/status (06-sessions kill9-initial) normalizes to undefined", () => {
    const runs = loadCliStreamRuns("06-sessions.raw.sanitized.json");
    const statusMessage = runs["kill9-initial"]?.find(
      (m) => m.type === "system" && messageSubtype(m) === "status",
    );
    expect(statusMessage).toBeDefined();
    expect(normalizeSdkMessage(statusMessage as SDKMessage, "fallback")).toBeUndefined();
  });

  it("stream_event (partial-message frames, --include-partial-messages) normalizes to undefined", () => {
    const runs = loadCliStreamRuns("06-sessions.raw.sanitized.json");
    const streamEvent = runs["kill9-initial"]?.find((m) => m.type === "stream_event");
    expect(streamEvent).toBeDefined();
    expect(normalizeSdkMessage(streamEvent as SDKMessage, "fallback")).toBeUndefined();
  });

  it("a raw 'user' message normalizes to undefined via the pure per-message mapping (pairing is normalizeSdkStream's job)", () => {
    const userMessage = HERMETICITY_MESSAGES.find((m) => m.type === "user");
    expect(userMessage).toBeDefined();
    expect(normalizeSdkMessage(userMessage as SDKMessage, "fallback")).toBeUndefined();
  });
});

describe("normalizeSdkMessage — EventNormalizationError on malformed handled-type messages", () => {
  it("throws when a result message's is_error is not a boolean", () => {
    const malformed = {
      type: "result",
      subtype: "success",
      is_error: "nope",
      num_turns: 1,
      total_cost_usd: 0,
      permission_denials: [],
      duration_ms: 0,
      duration_api_ms: 0,
      result: "x",
      stop_reason: null,
      usage: {},
      modelUsage: {},
      uuid: "u",
      session_id: "s",
    } as unknown as SDKMessage;
    expect(() => normalizeSdkMessage(malformed, "fallback")).toThrow(EventNormalizationError);
  });

  it("throws when a system/init message's tools is not a string array", () => {
    const malformed = {
      type: "system",
      subtype: "init",
      cwd: "/tmp",
      session_id: "s",
      tools: [1, 2, 3],
      mcp_servers: [],
      model: "m",
      permissionMode: "dontAsk",
      slash_commands: [],
      output_style: "default",
      skills: [],
      plugins: [],
      apiKeySource: "none",
      claude_code_version: "2.1.210",
      uuid: "u",
    } as unknown as SDKMessage;
    expect(() => normalizeSdkMessage(malformed, "fallback")).toThrow(EventNormalizationError);
  });

  it("wraps a malformed rate_limit_event's LimitSignalNormalizationError as EventNormalizationError", () => {
    const malformed = {
      type: "rate_limit_event",
      rate_limit_info: { status: "not-a-status" },
      uuid: "u",
      session_id: "s",
    } as unknown as SDKMessage;
    expect(() => normalizeSdkMessage(malformed, "fallback")).toThrow(EventNormalizationError);
  });

  it("throws when an assistant message's content is not an array", () => {
    const malformed = {
      type: "assistant",
      message: { content: "not-an-array" },
      parent_tool_use_id: null,
      uuid: "u",
      session_id: "s",
    } as unknown as SDKMessage;
    expect(() => normalizeSdkMessage(malformed, "fallback")).toThrow(EventNormalizationError);
  });
});

describe("normalizeSdkStream — toolUse/tool_result pairing (docs/engine-baseline.md §2)", () => {
  it("emits an unpaired toolUse event, then a paired one carrying toolResult once the matching tool_result arrives", async () => {
    const events = await collect(
      normalizeSdkStream(toAsyncIterable(HERMETICITY_MESSAGES), "fallback"),
    );
    const toolUseEvents = events.filter((e) => e.type === "toolUse");
    expect(toolUseEvents).toHaveLength(2);
    expect(toolUseEvents[0]?.toolUseId).toBe("toolu_01CYZ5Gtij91ebmb37LF7Beo");
    expect(toolUseEvents[0]?.toolResult).toBeUndefined();
    expect(toolUseEvents[1]?.toolUseId).toBe("toolu_01CYZ5Gtij91ebmb37LF7Beo");
    expect(toolUseEvents[1]?.toolResult).toBe("A= B=");
  });
});

describe("normalizeSdkStream — crash fixture ends without a result event (docs/engine-baseline.md §7, kill9-initial)", () => {
  it("yields events for the full crash-truncated stream and never yields a result event", async () => {
    const runs = loadCliStreamRuns("06-sessions.raw.sanitized.json");
    const messages = runs["kill9-initial"] ?? [];
    expect(messages.length).toBeGreaterThan(0);
    const events = await collect(normalizeSdkStream(toAsyncIterable(messages), "fallback"));
    expect(events.some((e) => e.type === "result")).toBe(false);
    // The crash fixture's own documented mid-stream rate_limit_event still normalizes.
    expect(events.some((e) => e.type === "limitSignal")).toBe(true);
  });
});

describe("resolveSessionId fallback (docs/engine-baseline.md §7 — session_id is optional on SDKUserMessage-like frames)", () => {
  it("falls back to fallbackSessionId when an assistant message's session_id is empty", () => {
    const message = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "hi" }],
      },
      parent_tool_use_id: null,
      uuid: "u",
      session_id: "",
    } as unknown as SDKMessage;
    expect(normalizeSdkMessage(message, "fallback-session")).toEqual({
      type: "assistant",
      sessionId: "fallback-session",
      text: "hi",
    });
  });
});

describe("normalizeSdkMessage — assistant content-block validation (each malformed shape → EventNormalizationError)", () => {
  function assistantMessage(content: unknown): SDKMessage {
    return {
      type: "assistant",
      message: { content },
      parent_tool_use_id: null,
      uuid: "u",
      session_id: "s",
    } as unknown as SDKMessage;
  }

  it("throws when a content block is missing a string 'type' discriminator", () => {
    expect(() => normalizeSdkMessage(assistantMessage([{ foo: "bar" }]), "fallback")).toThrow(
      EventNormalizationError,
    );
  });

  it("throws when a 'text' block is missing a string 'text' field", () => {
    expect(() => normalizeSdkMessage(assistantMessage([{ type: "text" }]), "fallback")).toThrow(
      EventNormalizationError,
    );
  });

  it("throws when a 'tool_use' block is missing string 'id'/'name'", () => {
    expect(() =>
      normalizeSdkMessage(assistantMessage([{ type: "tool_use", input: {} }]), "fallback"),
    ).toThrow(EventNormalizationError);
  });

  it("throws when a 'tool_use' block's 'input' is not an object", () => {
    expect(() =>
      normalizeSdkMessage(
        assistantMessage([{ type: "tool_use", id: "t1", name: "Bash", input: "not-an-object" }]),
        "fallback",
      ),
    ).toThrow(EventNormalizationError);
  });

  it("skips non-normalizable block types (e.g. 'thinking') and returns undefined when nothing else is present", () => {
    expect(
      normalizeSdkMessage(assistantMessage([{ type: "thinking", thinking: "..." }]), "fallback"),
    ).toBeUndefined();
  });
});

describe("normalizeSdkMessage — system/init field validation (each malformed shape → EventNormalizationError)", () => {
  function initMessage(overrides: Record<string, unknown>): SDKMessage {
    return {
      type: "system",
      subtype: "init",
      cwd: "/tmp",
      session_id: "s",
      tools: [],
      mcp_servers: [],
      model: "m",
      permissionMode: "dontAsk",
      slash_commands: [],
      output_style: "default",
      skills: [],
      plugins: [],
      apiKeySource: "none",
      claude_code_version: "2.1.210",
      uuid: "u",
      ...overrides,
    } as unknown as SDKMessage;
  }

  it("throws when model is not a string", () => {
    expect(() => normalizeSdkMessage(initMessage({ model: 7 }), "fallback")).toThrow(
      EventNormalizationError,
    );
  });

  it("throws when cwd is not a string", () => {
    expect(() => normalizeSdkMessage(initMessage({ cwd: 7 }), "fallback")).toThrow(
      EventNormalizationError,
    );
  });

  it("throws when mcp_servers is not an array", () => {
    expect(() => normalizeSdkMessage(initMessage({ mcp_servers: "nope" }), "fallback")).toThrow(
      EventNormalizationError,
    );
  });

  it("throws when an mcp_servers entry's name is not a string", () => {
    expect(() =>
      normalizeSdkMessage(
        initMessage({ mcp_servers: [{ name: 7, status: "connected" }] }),
        "fallback",
      ),
    ).toThrow(EventNormalizationError);
  });

  it("maps mcp_servers entries to their names when well-formed", () => {
    const event = normalizeSdkMessage(
      initMessage({ mcp_servers: [{ name: "example-gateway", status: "connected" }] }),
      "fallback",
    );
    expect(event?.type).toBe("init");
    if (event?.type === "init") {
      expect(event.mcpServers).toEqual(["example-gateway"]);
    }
  });
});

describe("normalizeSdkMessage — result field validation (each malformed shape → EventNormalizationError)", () => {
  function resultMessage(overrides: Record<string, unknown>): SDKMessage {
    return {
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 1,
      total_cost_usd: 0,
      permission_denials: [],
      duration_ms: 0,
      duration_api_ms: 0,
      result: "x",
      stop_reason: null,
      usage: {},
      modelUsage: {},
      uuid: "u",
      session_id: "s",
      ...overrides,
    } as unknown as SDKMessage;
  }

  it("throws when subtype is not a string", () => {
    expect(() => normalizeSdkMessage(resultMessage({ subtype: 7 }), "fallback")).toThrow(
      EventNormalizationError,
    );
  });

  it("throws when num_turns is not a number", () => {
    expect(() => normalizeSdkMessage(resultMessage({ num_turns: "two" }), "fallback")).toThrow(
      EventNormalizationError,
    );
  });

  it("throws when total_cost_usd is not a number", () => {
    expect(() =>
      normalizeSdkMessage(resultMessage({ total_cost_usd: "free" }), "fallback"),
    ).toThrow(EventNormalizationError);
  });

  it("throws when permission_denials itself is not an array", () => {
    expect(() =>
      normalizeSdkMessage(resultMessage({ permission_denials: "nope" }), "fallback"),
    ).toThrow(EventNormalizationError);
  });

  it("throws when a permission_denials entry is not an object", () => {
    expect(() =>
      normalizeSdkMessage(resultMessage({ permission_denials: [null] }), "fallback"),
    ).toThrow(EventNormalizationError);
  });

  it("throws when a permission_denials entry's tool_name is not a string", () => {
    expect(() =>
      normalizeSdkMessage(
        resultMessage({ permission_denials: [{ tool_name: 7, tool_input: {} }] }),
        "fallback",
      ),
    ).toThrow(EventNormalizationError);
  });

  it("throws when a permission_denials entry's tool_input is not an object", () => {
    expect(() =>
      normalizeSdkMessage(
        resultMessage({ permission_denials: [{ tool_name: "Bash", tool_input: "nope" }] }),
        "fallback",
      ),
    ).toThrow(EventNormalizationError);
  });

  it("throws when structured_output is present but not a plain object", () => {
    expect(() =>
      normalizeSdkMessage(
        resultMessage({ subtype: "success", structured_output: ["not", "an", "object"] }),
        "fallback",
      ),
    ).toThrow(EventNormalizationError);
  });

  it("does not validate structured_output shape for a non-'success' subtype", () => {
    const event = normalizeSdkMessage(
      resultMessage({
        subtype: "error_during_execution",
        is_error: true,
        structured_output: ["ignored"],
      }),
      "fallback",
    );
    expect(event?.type).toBe("result");
    if (event?.type === "result") {
      expect(event.structuredOutput).toBeUndefined();
    }
  });
});

describe("normalizeSdkStream — user-message tool_result extraction edge cases (docs/engine-baseline.md §2)", () => {
  function userMessage(content: unknown, sessionId = "s"): SDKMessage {
    return {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      uuid: "u",
      session_id: sessionId,
    } as unknown as SDKMessage;
  }

  it("a plain-string user message (ordinary prompt, not tool_result content) yields no events", async () => {
    const events = await collect(
      normalizeSdkStream(toAsyncIterable([userMessage("just a prompt")]), "fallback"),
    );
    expect(events).toEqual([]);
  });

  it("a content array with a null entry and a non-tool_result block is ignored, not an error", async () => {
    const events = await collect(
      normalizeSdkStream(
        toAsyncIterable([userMessage([null, { type: "text", text: "hi" }])]),
        "fallback",
      ),
    );
    expect(events).toEqual([]);
  });

  it("a tool_result with no matching cached tool_use is silently ignored (crash-tolerance)", async () => {
    const events = await collect(
      normalizeSdkStream(
        toAsyncIterable([
          userMessage([{ type: "tool_result", tool_use_id: "unknown-id", content: "x" }]),
        ]),
        "fallback",
      ),
    );
    expect(events).toEqual([]);
  });

  it("stringifies array-shaped tool_result content: text blocks joined, non-text blocks JSON-stringified", async () => {
    const assistant = {
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] },
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s",
    } as unknown as SDKMessage;
    const user = userMessage([
      {
        type: "tool_result",
        tool_use_id: "t1",
        content: [
          { type: "text", text: "hello " },
          { type: "image", source: "x" },
        ],
      },
    ]);
    const events = await collect(
      normalizeSdkStream(toAsyncIterable([assistant, user]), "fallback"),
    );
    const paired = events.find((e) => e.type === "toolUse" && e.toolResult !== undefined);
    expect(paired?.type).toBe("toolUse");
    if (paired?.type === "toolUse") {
      expect(paired.toolResult).toBe(`hello ${JSON.stringify({ type: "image", source: "x" })}`);
    }
  });

  it("stringifies an undefined tool_result content as an empty string", async () => {
    const assistant = {
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "t2", name: "Bash", input: {} }] },
      parent_tool_use_id: null,
      uuid: "u2",
      session_id: "s",
    } as unknown as SDKMessage;
    const user = userMessage([{ type: "tool_result", tool_use_id: "t2" }]);
    const events = await collect(
      normalizeSdkStream(toAsyncIterable([assistant, user]), "fallback"),
    );
    const paired = events.find((e) => e.type === "toolUse" && e.toolResult !== undefined);
    expect(paired?.type).toBe("toolUse");
    if (paired?.type === "toolUse") {
      expect(paired.toolResult).toBe("");
    }
  });

  it("stringifies a non-string, non-array tool_result content via JSON.stringify", async () => {
    const assistant = {
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "t3", name: "Bash", input: {} }] },
      parent_tool_use_id: null,
      uuid: "u3",
      session_id: "s",
    } as unknown as SDKMessage;
    const user = userMessage([{ type: "tool_result", tool_use_id: "t3", content: { code: 42 } }]);
    const events = await collect(
      normalizeSdkStream(toAsyncIterable([assistant, user]), "fallback"),
    );
    const paired = events.find((e) => e.type === "toolUse" && e.toolResult !== undefined);
    expect(paired?.type).toBe("toolUse");
    if (paired?.type === "toolUse") {
      expect(paired.toolResult).toBe(JSON.stringify({ code: 42 }));
    }
  });
});

describe("normalizeSdkStream — result-message error-string fallback detection (docs/engine-baseline.md §8)", () => {
  it("synthesizes a limitSignal event when a non-success result's errors[] matches the fallback phrase", async () => {
    const resultMessage = {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      num_turns: 1,
      total_cost_usd: 0,
      permission_denials: [],
      duration_ms: 0,
      duration_api_ms: 0,
      stop_reason: null,
      usage: {},
      modelUsage: {},
      errors: [BASELINE_LIMIT_ERROR_SAMPLE],
      uuid: "u",
      session_id: "session-err",
    } as unknown as SDKMessage;
    const events = await collect(normalizeSdkStream(toAsyncIterable([resultMessage]), "fallback"));
    expect(events.some((e) => e.type === "limitSignal" && e.status === "rejected")).toBe(true);
  });

  it("does not synthesize a limitSignal event for a benign non-success result", async () => {
    const resultMessage = {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      num_turns: 1,
      total_cost_usd: 0,
      permission_denials: [],
      duration_ms: 0,
      duration_api_ms: 0,
      stop_reason: null,
      usage: {},
      modelUsage: {},
      errors: ["connection reset"],
      uuid: "u",
      session_id: "session-ok",
    } as unknown as SDKMessage;
    const events = await collect(normalizeSdkStream(toAsyncIterable([resultMessage]), "fallback"));
    expect(events.some((e) => e.type === "limitSignal")).toBe(false);
  });
});
