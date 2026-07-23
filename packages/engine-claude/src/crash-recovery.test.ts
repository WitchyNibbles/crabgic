/**
 * roadmap/06-claude-engine-adapter.md work item 5's first failing test:
 * "kill -9 a running worker mid-turn, then `resume` — context and worktree
 * state must be intact — fails, no resume wiring exists." This suite
 * proves: (1) a scripted stream that ends abruptly mid-turn (no `result`)
 * simply ends the generator (crash shape); (2) `resume(sessionRef,
 * adjudicate)` reconnects with `Options.resume === sessionId`, the SAME
 * `cwd`/`CLAUDE_CONFIG_DIR` as the original spawn; (3) `fork` produces
 * `{resume: originalId, forkSession: true, sessionId: <new uuid>}` and
 * leaves the original `sessionRef` untouched; (4) 05's REAL
 * `spawnManagedWorker` (unchanged) integrates correctly with this REAL
 * adapter type end to end, including its `onCrash` recovery-hook call site.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { compileEnvelope, READ_ONLY_ENVELOPE } from "@eo/engine-core";
import { buildTaskPacket } from "@eo/testkit";
import { createWorkersRegistry, spawnManagedWorker } from "@eo/supervisor";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeEngineAdapterConfig, SdkQueryFunction } from "./adapter-config.js";
import { ClaudeEngineAdapter } from "./adapter.js";

function initMessage(sessionId: string, cwd: string): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    apiKeySource: "user",
    claude_code_version: "2.1.210",
    cwd,
    tools: ["Bash"],
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

function resultMessage(sessionId: string): SDKMessage {
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
    structured_output: {
      schemaVersion: 1,
      id: "44444444-4444-4444-4444-444444444444",
      workUnitId: "55555555-5555-4555-8555-555555555555",
      outcome: "succeeded",
      summary: "ok",
      diagnostics: [],
      usage: { turnsUsed: 1 },
    },
    uuid: "33333333-3333-3333-3333-333333333333",
    session_id: sessionId,
  } as unknown as SDKMessage;
}

interface ProbedCall {
  readonly options: Options | undefined;
}

function createScriptedSdkQuery(scripts: readonly (readonly SDKMessage[])[]): {
  readonly sdkQuery: SdkQueryFunction;
  readonly calls: ProbedCall[];
} {
  const calls: ProbedCall[] = [];
  let callIndex = 0;
  const sdkQuery: SdkQueryFunction = (params) => {
    calls.push({ options: params.options });
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

async function allowAdjudicate(
  _toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
): Promise<{
  readonly behavior: "allow";
  readonly updatedInput: Readonly<Record<string, unknown>>;
}> {
  return { behavior: "allow", updatedInput: toolInput };
}

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-engine-claude-crash-recovery-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

const READ_ONLY_PROFILE = compileEnvelope(READ_ONLY_ENVELOPE);
const WORKTREE_PATH = "/fixture/worktree";
const CONFIG_DIR = "/fixture/claude-config";

function buildConfig(sdkQuery: SdkQueryFunction): ClaudeEngineAdapterConfig {
  return {
    worktreePath: WORKTREE_PATH,
    provisioning: { HOME: "/fixture/home", TMP: "/fixture/tmp", CLAUDE_CONFIG_DIR: CONFIG_DIR },
    auth: { kind: "oauthToken", token: "test-oauth-token" },
    journal: store,
    engineVersionResolver: () => "2.1.210",
    sdkQuery,
  };
}

describe("crash shape: a stream that ends abruptly (no result event) just ends the generator", () => {
  it("collects only the pre-crash events, with no thrown error and no result event", async () => {
    const { sdkQuery } = createScriptedSdkQuery([
      [initMessage("s", WORKTREE_PATH), assistantTextMessage("s", "Remember the number 42")],
    ]);
    const adapter = new ClaudeEngineAdapter(buildConfig(sdkQuery));
    const packet = buildTaskPacket();

    const handle = adapter.spawn(packet, READ_ONLY_PROFILE, allowAdjudicate);
    const events = await collectAll(handle.events);

    expect(events.some((e) => e.type === "result")).toBe(false);
    expect(events.length).toBeGreaterThan(0);
  });
});

describe("resume(sessionRef, adjudicate) reconnects the SAME sessionId/cwd/configDir", () => {
  it("Options.resume === sessionId, cwd/env.CLAUDE_CONFIG_DIR match the crashed session's own sessionRef", async () => {
    const { sdkQuery, calls } = createScriptedSdkQuery([
      [initMessage("s1", WORKTREE_PATH), assistantTextMessage("s1", "42")], // crash: no result
      [initMessage("s1", WORKTREE_PATH), resultMessage("s1")], // resume: clean completion
    ]);
    const adapter = new ClaudeEngineAdapter(buildConfig(sdkQuery));
    const packet = buildTaskPacket();

    const crashedHandle = adapter.spawn(packet, READ_ONLY_PROFILE, allowAdjudicate);
    await collectAll(crashedHandle.events);

    const resumedHandle = adapter.resume(crashedHandle.sessionRef, allowAdjudicate);
    await collectAll(resumedHandle.events);

    const resumeCallOptions = calls[1]?.options;
    expect(resumeCallOptions?.resume).toBe(crashedHandle.sessionRef.sessionId);
    expect(resumeCallOptions?.cwd).toBe(crashedHandle.sessionRef.worktreePath);
    expect(resumeCallOptions?.env?.CLAUDE_CONFIG_DIR).toBe(crashedHandle.sessionRef.configDir);
    // resume() does NOT pre-assign a new sessionId — resume's own session
    // spec carries no `sessionId` field (see options-assembler.ts's
    // WorkerSessionSpec "resume" variant).
    expect(resumeCallOptions?.sessionId).toBeUndefined();
    expect(resumedHandle.sessionRef.sessionId).toBe(crashedHandle.sessionRef.sessionId);
  });
});

describe("fork(sessionRef, adjudicate) isolates a repair attempt", () => {
  it("Options carry {resume: originalId, forkSession: true, sessionId: <new uuid>} and the original sessionRef is untouched", async () => {
    const { sdkQuery, calls } = createScriptedSdkQuery([
      [initMessage("s1", WORKTREE_PATH), resultMessage("s1")], // original spawn
      [initMessage("s2", WORKTREE_PATH), resultMessage("s2")], // fork
    ]);
    const adapter = new ClaudeEngineAdapter(buildConfig(sdkQuery));
    const packet = buildTaskPacket();

    const originalHandle = adapter.spawn(packet, READ_ONLY_PROFILE, allowAdjudicate);
    await collectAll(originalHandle.events);
    const originalSessionId = originalHandle.sessionRef.sessionId;
    const originalWorktreePath = originalHandle.sessionRef.worktreePath;
    const originalConfigDir = originalHandle.sessionRef.configDir;

    const forkedHandle = adapter.fork(originalHandle.sessionRef, allowAdjudicate);
    await collectAll(forkedHandle.events);

    const forkCallOptions = calls[1]?.options;
    expect(forkCallOptions?.resume).toBe(originalSessionId);
    expect(forkCallOptions?.forkSession).toBe(true);
    expect(forkCallOptions?.sessionId).toBe(forkedHandle.sessionRef.sessionId);
    expect(forkedHandle.sessionRef.sessionId).not.toBe(originalSessionId);

    // Original sessionRef untouched.
    expect(originalHandle.sessionRef.sessionId).toBe(originalSessionId);
    expect(originalHandle.sessionRef.worktreePath).toBe(originalWorktreePath);
    expect(originalHandle.sessionRef.configDir).toBe(originalConfigDir);
  });
});

describe("credentialsFile auth: resume/fork re-provision the SAME CLAUDE_CONFIG_DIR without crashing", () => {
  it("spawn plants .credentials.json, then resume re-provisions idempotently (no WorkerAuthError from the recovery generator)", async () => {
    // Regression: `buildHandle`'s generator calls `provisionWorkerAuth` on
    // EVERY spawn/resume/fork against the session's own configDir. With the
    // `credentialsFile` mechanism (the confirmed-PASS fallback,
    // docs/engine-baseline.md §1) the first spawn writes `.credentials.json`;
    // a resume then hits the SAME dir. This must NOT throw (idempotent
    // re-provision) — otherwise every credentialsFile recovery is a permanent
    // crash-loop, breaking exit criterion `crash-recovery.live.test`.
    const authDir = await mkdtemp(join(tmpdir(), "eo-engine-claude-credfile-"));
    try {
      const sourcePath = join(authDir, "owner-credentials.json");
      const configDir = join(authDir, "worker-claude-config");
      await mkdir(configDir, { recursive: true });
      await writeFile(sourcePath, `{"credmarker":"owner-subscription-blob"}`, { mode: 0o600 });

      const { sdkQuery } = createScriptedSdkQuery([
        [initMessage("s1", WORKTREE_PATH), assistantTextMessage("s1", "42")], // crash: no result
        [initMessage("s1", WORKTREE_PATH), resultMessage("s1")], // resume: clean completion
      ]);
      const config: ClaudeEngineAdapterConfig = {
        worktreePath: WORKTREE_PATH,
        provisioning: { HOME: "/fixture/home", TMP: "/fixture/tmp", CLAUDE_CONFIG_DIR: configDir },
        auth: { kind: "credentialsFile", sourcePath },
        journal: store,
        engineVersionResolver: () => "2.1.210",
        sdkQuery,
      };
      const adapter = new ClaudeEngineAdapter(config);
      const packet = buildTaskPacket();

      const crashedHandle = adapter.spawn(packet, READ_ONLY_PROFILE, allowAdjudicate);
      await collectAll(crashedHandle.events);

      // The whole point: resuming into the same configDir must resolve, not
      // reject with a WorkerAuthError over the pre-existing .credentials.json.
      const resumedHandle = adapter.resume(crashedHandle.sessionRef, allowAdjudicate);
      const resumedEvents = await collectAll(resumedHandle.events);
      expect(resumedEvents.some((e) => e.type === "result")).toBe(true);
    } finally {
      await rm(authDir, { recursive: true, force: true });
    }
  });
});

describe("supervisor integration: 05's REAL spawnManagedWorker with a REAL ClaudeEngineAdapter", () => {
  it("a scripted crash produces a 'crashed' outcome and fires the onCrash recovery hook", async () => {
    const { sdkQuery } = createScriptedSdkQuery([
      [initMessage("s", WORKTREE_PATH), assistantTextMessage("s", "mid-turn, then nothing")],
    ]);
    const adapter = new ClaudeEngineAdapter(buildConfig(sdkQuery));
    const workers = createWorkersRegistry();
    const packet = buildTaskPacket();
    const crashHookCalls: string[] = [];

    const managed = await spawnManagedWorker({
      adapter,
      journal: store,
      workers,
      packet,
      profile: READ_ONLY_PROFILE,
      adjudicate: allowAdjudicate,
      onCrash: (worker) => {
        crashHookCalls.push(worker.workerId);
      },
    });

    const outcome = await managed.settled;
    expect(outcome).toBe("crashed");
    expect(workers.get(managed.workerId)?.status).toBe("crashed");
    expect(crashHookCalls).toEqual([managed.workerId]);

    const sessionEntries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "session_assignment" })) {
      sessionEntries.push(entry);
    }
    expect(sessionEntries.length).toBeGreaterThan(0);
  });
});
