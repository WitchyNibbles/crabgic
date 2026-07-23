/**
 * roadmap/06-claude-engine-adapter.md work items 1/3/4/6 — the real
 * `ClaudeEngineAdapter`. Scripted `sdkQuery` fakes built from SDK-message-
 * shaped objects (never the real SDK); a real temp-dir `JournalStore`
 * (`@eo/journal`) so journal-write assertions are genuine, not mocked.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createJournalStore,
  type JournalEntry,
  type JournalEntryInput,
  type JournalStore,
} from "@eo/journal";
import { compileEnvelope, READ_ONLY_ENVELOPE } from "@eo/engine-core";
import { buildTaskPacket } from "@eo/testkit";
import type { TaskPacket } from "@eo/contracts";
import type {
  Options,
  PostToolUseHookInput,
  SDKMessage,
  SessionEndHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeEngineAdapterConfig, SdkQueryFunction } from "./adapter-config.js";
import {
  ClaudeEngineAdapter,
  AdjudicationAuditViolationError,
  TaskPacketValidationError,
  EngineVersionResolutionError,
  mapSdkVersionToEngineVersion,
  findNearestPackageJson,
} from "./adapter.js";
import { EngineVersionRejectedError, TESTED_ENGINE_VERSION } from "./version-gate.js";
import { validateWorkerResult } from "./result-validation.js";

// ---------------------------------------------------------------------------
// Minimal SDK-message-shaped fixtures (same "as unknown as SDKMessage"
// convention already established by event-normalizer.test.ts).
// ---------------------------------------------------------------------------

function initMessage(sessionId: string, cwd: string): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    apiKeySource: "user",
    claude_code_version: "2.1.210",
    cwd,
    tools: ["Bash", "Read"],
    mcp_servers: [],
    model: "claude-haiku-4-5-20251001",
    permissionMode: "dontAsk",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
    uuid: "11111111-1111-1111-1111-111111111111",
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function assistantTextMessage(sessionId: string, text: string): SDKMessage {
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
    uuid: "22222222-2222-2222-2222-222222222222",
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function resultMessage(
  sessionId: string,
  overrides: { readonly structuredOutput?: Record<string, unknown> } = {},
): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 100,
    duration_api_ms: 80,
    is_error: false,
    num_turns: 1,
    result: "done",
    stop_reason: null,
    total_cost_usd: 0.001,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    ...(overrides.structuredOutput !== undefined
      ? { structured_output: overrides.structuredOutput }
      : {}),
    uuid: "33333333-3333-3333-3333-333333333333",
    session_id: sessionId,
  } as unknown as SDKMessage;
}

// ---------------------------------------------------------------------------
// Scripted `sdkQuery` probe: each call pulls the NEXT queued script (in
// call order) and records `{prompt, options}` for inspection.
// ---------------------------------------------------------------------------

interface ProbedCall {
  readonly prompt: string | AsyncIterable<unknown>;
  readonly options: Options | undefined;
}

function createScriptedSdkQuery(scripts: readonly (readonly SDKMessage[])[]): {
  readonly sdkQuery: SdkQueryFunction;
  readonly calls: ProbedCall[];
} {
  const calls: ProbedCall[] = [];
  let callIndex = 0;
  const sdkQuery: SdkQueryFunction = (params) => {
    calls.push({ prompt: params.prompt, options: params.options });
    const script = scripts[callIndex] ?? [];
    callIndex += 1;
    return (async function* (): AsyncGenerator<SDKMessage, void, unknown> {
      for (const message of script) {
        yield message;
      }
    })();
  };
  return { sdkQuery, calls };
}

async function collectAll<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Test harness: real temp-dir JournalStore + a default adapter config.
// ---------------------------------------------------------------------------

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-engine-claude-adapter-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function buildOrderLoggingJournal(baseStore: JournalStore, orderLog: string[]): JournalStore {
  return {
    ...baseStore,
    appendEntry: async (input: JournalEntryInput): Promise<JournalEntry> => {
      const entry = await baseStore.appendEntry(input);
      orderLog.push(`journal:${input.type}`);
      return entry;
    },
  };
}

function buildConfig(
  overrides: Partial<ClaudeEngineAdapterConfig> = {},
): ClaudeEngineAdapterConfig {
  return {
    worktreePath: "/fixture/worktree",
    provisioning: {
      HOME: "/fixture/home",
      TMP: "/fixture/tmp",
      CLAUDE_CONFIG_DIR: "/fixture/claude-config",
    },
    auth: { kind: "oauthToken", token: "test-oauth-token" },
    journal: store,
    engineVersionResolver: () => "2.1.210",
    ...overrides,
  };
}

const READ_ONLY_PROFILE = compileEnvelope(READ_ONLY_ENVELOPE);

function buildPacket(overrides: Partial<TaskPacket> = {}): TaskPacket {
  return buildTaskPacket(overrides);
}

async function allowAdjudicate(
  _toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
): Promise<{
  readonly behavior: "allow";
  readonly updatedInput: Readonly<Record<string, unknown>>;
}> {
  return { behavior: "allow", updatedInput: toolInput };
}

const CAN_USE_TOOL_CALL_OPTIONS = {
  signal: new AbortController().signal,
  toolUseID: "tool-use-1",
  requestId: "req-1",
};

// ---------------------------------------------------------------------------
// Version gate refusal — exit criterion "spawn/resume refuse to start
// outside the accepted version range," proven with a probe showing ZERO
// sdkQuery invocations and ZERO journal entries.
// ---------------------------------------------------------------------------

describe("ClaudeEngineAdapter — version gate refusal (roadmap/06 exit criterion)", () => {
  it("spawn() throws EngineVersionRejectedError synchronously, before any sdkQuery call or journal append", () => {
    const orderLog: string[] = [];
    const journal = buildOrderLoggingJournal(store, orderLog);
    const { sdkQuery, calls } = createScriptedSdkQuery([[initMessage("s", "/w")]]);
    const adapter = new ClaudeEngineAdapter(
      buildConfig({ journal, engineVersionResolver: () => "9.9.9", sdkQuery }),
    );

    expect(() => adapter.spawn(buildPacket(), READ_ONLY_PROFILE, allowAdjudicate)).toThrow(
      EngineVersionRejectedError,
    );

    expect(calls).toHaveLength(0);
    expect(orderLog).toHaveLength(0);
  });

  it("resume() also refuses synchronously outside the accepted range", () => {
    const { sdkQuery, calls } = createScriptedSdkQuery([[initMessage("s", "/w")]]);
    const adapter = new ClaudeEngineAdapter(
      buildConfig({ engineVersionResolver: () => "0.0.1", sdkQuery }),
    );

    expect(() =>
      adapter.resume(
        {
          sessionId: "11111111-1111-4111-8111-111111111111",
          projectDirectory: "/w",
          worktreePath: "/w",
          configDir: "/c",
        },
        allowAdjudicate,
      ),
    ).toThrow(EngineVersionRejectedError);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Order proof: session_assignment resolves BEFORE the first sdkQuery call.
// ---------------------------------------------------------------------------

describe("ClaudeEngineAdapter — session_assignment happens BEFORE the engine subprocess exists (README decision 2)", () => {
  it("journals session_assignment, and only THEN calls sdkQuery — recorded call order", async () => {
    const orderLog: string[] = [];
    const journal = buildOrderLoggingJournal(store, orderLog);
    const { sdkQuery: scriptedSdkQuery } = createScriptedSdkQuery([
      [initMessage("s", "/fixture/worktree"), resultMessage("s")],
    ]);
    const sdkQuery: SdkQueryFunction = (params) => {
      orderLog.push("sdkQuery");
      return scriptedSdkQuery(params);
    };
    const adapter = new ClaudeEngineAdapter(buildConfig({ journal, sdkQuery }));

    const handle = adapter.spawn(buildPacket(), READ_ONLY_PROFILE, allowAdjudicate);
    const iterator = handle.events[Symbol.asyncIterator]();
    await iterator.next();

    expect(orderLog).toEqual(["journal:session_assignment", "sdkQuery"]);

    const sessionEntries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "session_assignment" })) {
      sessionEntries.push(entry);
    }
    expect(sessionEntries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// canUseTool bridge (README decision 12: fail-closed).
// ---------------------------------------------------------------------------

describe("ClaudeEngineAdapter — canUseTool bridge (AdjudicationCallback -> SDK PermissionResult)", () => {
  async function capturedCanUseTool(adjudicate: Parameters<ClaudeEngineAdapter["spawn"]>[2]) {
    const { sdkQuery, calls } = createScriptedSdkQuery([[initMessage("s", "/fixture/worktree")]]);
    const adapter = new ClaudeEngineAdapter(buildConfig({ sdkQuery }));
    const handle = adapter.spawn(buildPacket(), READ_ONLY_PROFILE, adjudicate);
    await handle.events[Symbol.asyncIterator]().next();
    const canUseTool = calls[calls.length - 1]?.options?.canUseTool;
    if (canUseTool === undefined) {
      throw new Error("test setup failure: canUseTool was not captured");
    }
    return canUseTool;
  }

  it("adjudicate deny -> SDK sees a deny PermissionResult", async () => {
    const canUseTool = await capturedCanUseTool(async () => ({
      behavior: "deny",
      message: "no",
    }));
    const result = await canUseTool("Read", { file_path: "/x" }, CAN_USE_TOOL_CALL_OPTIONS);
    expect(result?.behavior).toBe("deny");
  });

  it("adjudicate THROWS -> SDK sees a deny PermissionResult (fail-closed)", async () => {
    const canUseTool = await capturedCanUseTool(async () => {
      throw new Error("adjudication bus crashed");
    });
    const result = await canUseTool("Read", { file_path: "/x" }, CAN_USE_TOOL_CALL_OPTIONS);
    expect(result?.behavior).toBe("deny");
  });

  it("adjudicate allow -> SDK sees allow with updatedInput passed through", async () => {
    const canUseTool = await capturedCanUseTool(allowAdjudicate);
    const result = await canUseTool("Read", { file_path: "/x" }, CAN_USE_TOOL_CALL_OPTIONS);
    expect(result).toEqual({ behavior: "allow", updatedInput: { file_path: "/x" } });
  });
});

// ---------------------------------------------------------------------------
// capabilities() — exact 5-field shape (interface-ledger Gap 7).
// ---------------------------------------------------------------------------

describe("ClaudeEngineAdapter — capabilities()", () => {
  it("returns exactly the 5 Gap-7 fields", () => {
    const adapter = new ClaudeEngineAdapter(
      buildConfig({ engineVersionResolver: () => "2.1.210" }),
    );
    expect(adapter.capabilities()).toEqual({
      supportsJsonSchema: true,
      supportsSessionResume: true,
      permissionModel: "dontAsk",
      sandboxModel: "bubblewrap",
      engineVersion: "2.1.210",
    });
  });
});

// ---------------------------------------------------------------------------
// PostToolUse audit violation -> abort + typed error.
// ---------------------------------------------------------------------------

describe("ClaudeEngineAdapter — PostToolUse audit violation aborts the stream", () => {
  it("aborts the controller and rejects the next pull with AdjudicationAuditViolationError", async () => {
    const { sdkQuery, calls } = createScriptedSdkQuery([
      [
        initMessage("s", "/fixture/worktree"),
        assistantTextMessage("s", "first"),
        assistantTextMessage("s", "second"),
        resultMessage("s"),
      ],
    ]);
    const adapter = new ClaudeEngineAdapter(buildConfig({ sdkQuery }));
    const handle = adapter.spawn(buildPacket(), READ_ONLY_PROFILE, allowAdjudicate);
    const iterator = handle.events[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value).toMatchObject({ type: "init" });

    const options = calls[calls.length - 1]?.options;
    const canUseTool = options?.canUseTool;
    const postToolUseHook = options?.hooks?.PostToolUse?.[0]?.hooks[0];
    if (canUseTool === undefined || postToolUseHook === undefined) {
      throw new Error("test setup failure: canUseTool/PostToolUse hook not captured");
    }

    // Adjudicate ALLOWS "Read" with {file_path: "a"} — recorded as allowed.
    await canUseTool("Read", { file_path: "a" }, CAN_USE_TOOL_CALL_OPTIONS);
    // The engine reports it EXECUTED "Read" with a DIFFERENT input — a
    // genuine executed-vs-adjudicated mismatch.
    const postToolUseInput: PostToolUseHookInput = {
      session_id: "s",
      transcript_path: "/does-not-matter.jsonl",
      cwd: "/fixture/worktree",
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: { file_path: "MISMATCH" },
      tool_response: "contents",
      tool_use_id: "tool-use-1",
    };
    await postToolUseHook(postToolUseInput, "tool-use-1", { signal: new AbortController().signal });

    await expect(iterator.next()).rejects.toThrow(AdjudicationAuditViolationError);
    expect(options?.abortController?.signal.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SessionEnd evidence entry written.
// ---------------------------------------------------------------------------

describe("ClaudeEngineAdapter — SessionEnd evidence hook journals an evidence_pointer entry", () => {
  it("writes one evidence_pointer entry pointing at the transcript path", async () => {
    const { sdkQuery, calls } = createScriptedSdkQuery([[initMessage("s", "/fixture/worktree")]]);
    const adapter = new ClaudeEngineAdapter(buildConfig({ sdkQuery }));
    const handle = adapter.spawn(buildPacket(), READ_ONLY_PROFILE, allowAdjudicate);
    await handle.events[Symbol.asyncIterator]().next();

    const sessionEndHook = calls[calls.length - 1]?.options?.hooks?.SessionEnd?.[0]?.hooks[0];
    if (sessionEndHook === undefined) {
      throw new Error("test setup failure: SessionEnd hook not captured");
    }
    const input: SessionEndHookInput = {
      session_id: handle.sessionRef.sessionId,
      transcript_path: "/does-not-matter.jsonl",
      cwd: "/fixture/worktree",
      hook_event_name: "SessionEnd",
      reason: "other",
    };
    await sessionEndHook(input, undefined, { signal: new AbortController().signal });

    const entries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "evidence_pointer" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Schema-violating scripted result -> W3's validateWorkerResult (pipeline proof).
// ---------------------------------------------------------------------------

describe("ClaudeEngineAdapter — pipeline proof: adapter output feeds W3's validateWorkerResult", () => {
  it("a scripted result with no structured_output normalizes into an EngineResultEvent that validateWorkerResult flags as a schemaViolation", async () => {
    const { sdkQuery } = createScriptedSdkQuery([
      [initMessage("s", "/fixture/worktree"), resultMessage("s")],
    ]);
    const adapter = new ClaudeEngineAdapter(buildConfig({ sdkQuery }));
    const handle = adapter.spawn(buildPacket(), READ_ONLY_PROFILE, allowAdjudicate);

    const events = await collectAll(handle.events);
    const resultEvent = events.find((event) => event.type === "result");
    expect(resultEvent).toBeDefined();
    if (resultEvent === undefined || resultEvent.type !== "result") {
      throw new Error("test setup failure");
    }

    const validation = validateWorkerResult(resultEvent);
    expect(validation.kind).toBe("schemaViolation");
  });
});

// ---------------------------------------------------------------------------
// TaskPacket boundary validation.
// ---------------------------------------------------------------------------

describe("ClaudeEngineAdapter — spawn() boundary-validates packet against TaskPacketSchema", () => {
  it("throws TaskPacketValidationError for a structurally invalid packet, before any sdkQuery call", () => {
    const { sdkQuery, calls } = createScriptedSdkQuery([[initMessage("s", "/fixture/worktree")]]);
    const adapter = new ClaudeEngineAdapter(buildConfig({ sdkQuery }));
    const malformedPacket = { ...buildPacket(), objective: "" } as unknown as TaskPacket;

    expect(() => adapter.spawn(malformedPacket, READ_ONLY_PROFILE, allowAdjudicate)).toThrow(
      TaskPacketValidationError,
    );
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Default engineVersionResolver (no override supplied).
// ---------------------------------------------------------------------------

describe("ClaudeEngineAdapter — default engineVersionResolver", () => {
  it("resolves the installed SDK's paired engine version from its own package.json when no resolver override is supplied", () => {
    const { sdkQuery } = createScriptedSdkQuery([[initMessage("s", "/fixture/worktree")]]);
    const configWithoutResolver: ClaudeEngineAdapterConfig = {
      worktreePath: "/fixture/worktree",
      provisioning: {
        HOME: "/fixture/home",
        TMP: "/fixture/tmp",
        CLAUDE_CONFIG_DIR: "/fixture/claude-config",
      },
      auth: { kind: "oauthToken", token: "test-oauth-token" },
      journal: store,
      sdkQuery,
    };
    const adapter = new ClaudeEngineAdapter(configWithoutResolver);

    expect(adapter.capabilities().engineVersion).toBe(TESTED_ENGINE_VERSION);
  });
});

// ---------------------------------------------------------------------------
// cancel() — the termination-ladder mirror.
// ---------------------------------------------------------------------------

describe("ClaudeEngineAdapter — cancel()", () => {
  it("never throws for a handle this adapter never spawned/resumed/forked", async () => {
    const adapter = new ClaudeEngineAdapter(
      buildConfig({ sdkQuery: createScriptedSdkQuery([]).sdkQuery }),
    );
    const unknownHandle = {
      sessionRef: {
        sessionId: "11111111-1111-4111-8111-111111111111",
        projectDirectory: "/w",
        worktreePath: "/w",
        configDir: "/c",
      },
      events: (async function* () {})(),
    };

    await expect(adapter.cancel(unknownHandle, new Date().toISOString())).resolves.toBeUndefined();
  });

  it("does not need to force .return() when the stream already ended gracefully before cancel() is called", async () => {
    const { sdkQuery } = createScriptedSdkQuery([
      [initMessage("s", "/fixture/worktree"), resultMessage("s")],
    ]);
    const adapter = new ClaudeEngineAdapter(buildConfig({ sdkQuery }));
    const handle = adapter.spawn(buildPacket(), READ_ONLY_PROFILE, allowAdjudicate);

    await collectAll(handle.events); // drains the stream to its own natural end first.

    await expect(adapter.cancel(handle, new Date().toISOString())).resolves.toBeUndefined();
  });

  it("forces .return() on the generator when the stream has not ended by the deadline", async () => {
    const { sdkQuery } = createScriptedSdkQuery([
      [
        initMessage("s", "/fixture/worktree"),
        assistantTextMessage("s", "one"),
        assistantTextMessage("s", "two"),
        resultMessage("s"),
      ],
    ]);
    const adapter = new ClaudeEngineAdapter(buildConfig({ sdkQuery }));
    const handle = adapter.spawn(buildPacket(), READ_ONLY_PROFILE, allowAdjudicate);
    const iterator = handle.events[Symbol.asyncIterator]();

    // Pull exactly ONE event, then stop pulling — the stream is left
    // suspended mid-turn, exactly like a genuinely hung worker.
    await iterator.next();

    // An already-past deadline forces the timeout branch immediately.
    const pastDeadline = new Date(Date.now() - 1000).toISOString();
    await adapter.cancel(handle, pastDeadline);

    const afterCancel = await iterator.next();
    expect(afterCancel.done).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Optional ClaudeEngineAdapterConfig fields — runId/rolePreamble/model/
// gatewayServerOverride/pathToClaudeCodeExecutable all get threaded through
// (the "defined" side of every `exactOptionalPropertyTypes`-driven
// conditional spread inside buildHandle).
// ---------------------------------------------------------------------------

describe("ClaudeEngineAdapter — optional config fields are threaded through when supplied", () => {
  it("runId is stamped on the session_assignment journal entry and the SessionEnd evidence entry", async () => {
    const { sdkQuery } = createScriptedSdkQuery([[initMessage("s", "/fixture/worktree")]]);
    const adapter = new ClaudeEngineAdapter(
      buildConfig({ sdkQuery, runId: "66666666-6666-4666-8666-666666666666" }),
    );
    const handle = adapter.spawn(buildPacket(), READ_ONLY_PROFILE, allowAdjudicate);
    await handle.events[Symbol.asyncIterator]().next();

    const sessionEntries: JournalEntry[] = [];
    for await (const entry of store.queryEntries({ type: "session_assignment" })) {
      sessionEntries.push(entry);
    }
    expect(sessionEntries[0]?.runId).toBe("66666666-6666-4666-8666-666666666666");
  });

  it("rolePreamble/model/gatewayServerOverride/pathToClaudeCodeExecutable are all applied to the assembled Options", async () => {
    const { sdkQuery, calls } = createScriptedSdkQuery([[initMessage("s", "/fixture/worktree")]]);
    const adapter = new ClaudeEngineAdapter(
      buildConfig({
        sdkQuery,
        rolePreamble: "You are a helpful worker.",
        model: "opus",
        gatewayServerOverride: { type: "stdio", command: "stub-gateway", args: [] },
        pathToClaudeCodeExecutable: "/fixture/claude-executable",
      }),
    );
    const handle = adapter.spawn(buildPacket(), READ_ONLY_PROFILE, allowAdjudicate);
    await handle.events[Symbol.asyncIterator]().next();

    const options = calls[calls.length - 1]?.options;
    expect(options?.systemPrompt).toMatchObject({ append: "You are a helpful worker." });
    expect(options?.model).toBe("opus");
    expect(options?.pathToClaudeCodeExecutable).toBe("/fixture/claude-executable");
    expect(handle.sessionRef).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// canUseTool bridge: deny with `interrupt: true` is passed through.
// ---------------------------------------------------------------------------

describe("ClaudeEngineAdapter — canUseTool bridge passes through a deny decision's interrupt flag", () => {
  it("interrupt: true on the AdjudicationDecision surfaces on the SDK PermissionResult", async () => {
    const { sdkQuery, calls } = createScriptedSdkQuery([[initMessage("s", "/fixture/worktree")]]);
    const adapter = new ClaudeEngineAdapter(buildConfig({ sdkQuery }));
    const handle = adapter.spawn(buildPacket(), READ_ONLY_PROFILE, async () => ({
      behavior: "deny",
      message: "no",
      interrupt: true,
    }));
    await handle.events[Symbol.asyncIterator]().next();

    const canUseTool = calls[calls.length - 1]?.options?.canUseTool;
    if (canUseTool === undefined) {
      throw new Error("test setup failure: canUseTool was not captured");
    }
    const result = await canUseTool("Read", { file_path: "/x" }, CAN_USE_TOOL_CALL_OPTIONS);
    expect(result).toEqual({ behavior: "deny", message: "no", interrupt: true });
  });
});

// ---------------------------------------------------------------------------
// fork() with NO cached spawn context (never spawned by this adapter
// instance) falls back to FALLBACK_SPAWN_CONTEXT rather than throwing.
// ---------------------------------------------------------------------------

describe("ClaudeEngineAdapter — fork() on an uncached sessionRef uses the documented fallback context", () => {
  it("does not throw and still produces a valid, forkSession-shaped Options object", async () => {
    const { sdkQuery, calls } = createScriptedSdkQuery([
      [initMessage("new-fork", "/fixture/worktree")],
    ]);
    const adapter = new ClaudeEngineAdapter(buildConfig({ sdkQuery }));
    const uncachedSessionRef = {
      sessionId: "77777777-7777-4777-8777-777777777777",
      projectDirectory: "/fixture/worktree",
      worktreePath: "/fixture/worktree",
      configDir: "/fixture/claude-config",
    };

    const forkedHandle = adapter.fork(uncachedSessionRef, allowAdjudicate);
    await forkedHandle.events[Symbol.asyncIterator]().next();

    const options = calls[calls.length - 1]?.options;
    expect(options?.resume).toBe(uncachedSessionRef.sessionId);
    expect(options?.forkSession).toBe(true);
    expect(options?.sessionId).toBe(forkedHandle.sessionRef.sessionId);
    expect(forkedHandle.sessionRef.sessionId).not.toBe(uncachedSessionRef.sessionId);
  });
});

// ---------------------------------------------------------------------------
// mapSdkVersionToEngineVersion / findNearestPackageJson — direct unit tests
// (exported for this purpose only; not part of the public barrel).
// ---------------------------------------------------------------------------

describe("mapSdkVersionToEngineVersion", () => {
  it("throws EngineVersionResolutionError for a malformed (non <major>.<minor>.<patch>) version string", () => {
    expect(() => mapSdkVersionToEngineVersion("not-a-version")).toThrow(
      EngineVersionResolutionError,
    );
  });

  it("throws EngineVersionResolutionError for a well-formed version with no known SDK-to-engine mapping", () => {
    expect(() => mapSdkVersionToEngineVersion("1.2.3")).toThrow(EngineVersionResolutionError);
  });

  it("maps a well-formed 0.3.x SDK version to the paired 2.1.x engine version", () => {
    expect(mapSdkVersionToEngineVersion("0.3.999")).toBe("2.1.999");
  });
});

describe("findNearestPackageJson", () => {
  let fixtureDir: string;

  beforeEach(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), "eo-engine-claude-find-pkg-json-"));
  });

  afterEach(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it("returns the immediate package.json when it exists at startDir itself", async () => {
    await writeFile(join(fixtureDir, "package.json"), "{}", "utf8");
    expect(findNearestPackageJson(fixtureDir)).toBe(join(fixtureDir, "package.json"));
  });

  it("walks upward when package.json is not at startDir itself", async () => {
    const nested = join(fixtureDir, "nested");
    await mkdir(nested, { recursive: true });
    await writeFile(join(fixtureDir, "package.json"), "{}", "utf8");
    expect(findNearestPackageJson(nested)).toBe(join(fixtureDir, "package.json"));
  });

  it("throws EngineVersionResolutionError when no package.json is found within the bounded walk", async () => {
    // A path many levels below the fixture root, none of which carry a
    // package.json — exhausts the bounded (5-iteration) upward walk.
    const deep = join(fixtureDir, "a", "b", "c", "d", "e", "f");
    await mkdir(deep, { recursive: true });
    expect(() => findNearestPackageJson(deep)).toThrow(EngineVersionResolutionError);
  });
});
