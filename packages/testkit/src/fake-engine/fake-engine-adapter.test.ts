import { describe, expect, it } from "vitest";
import { compileEnvelope, type CompiledWorkerProfile, type SessionRef } from "@eo/engine-core";
import type { EngineEvent, EngineResultEvent, EngineToolUseEvent } from "@eo/engine-core";
import { WorkerResultSchema } from "@eo/contracts";
import { buildAuthorizationEnvelope } from "../fixtures/authorization-envelope.js";
import { buildTaskPacket } from "../fixtures/task-packet.js";
import { alwaysAllowAdjudicate } from "./adjudication-layer.js";
import { buildFakeEngineScript } from "./scripted-trace.js";
import { FakeEngineAdapter } from "./fake-engine-adapter.js";

/**
 * roadmap/03-envelope-compiler-engine-adapter.md work item 5's own
 * failing-first fixture: "a test spawning the not-yet-built fake engine
 * against a phase-00 scripted trace and asserting ordered `EngineEvent`
 * replay — fails until it exists." See
 * `docs/evidence/phase-03/wi5-fake-engine-failing.txt`.
 */
function buildRealProfile(): CompiledWorkerProfile {
  return compileEnvelope(buildAuthorizationEnvelope());
}

function buildEchoAllowedProfile(): CompiledWorkerProfile {
  const base = buildRealProfile();
  return {
    ...base,
    permissions: { ...base.permissions, allow: [...base.permissions.allow, "Bash(echo:*)"] },
  };
}

async function collect(events: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("FakeEngineAdapter — ordered EngineEvent replay (work item 5 failing-first fixture)", () => {
  it("replays init -> toolUse -> result for an allowed scripted call", async () => {
    const script = buildFakeEngineScript({
      toolCalls: [{ toolName: "Bash", toolInput: { command: "echo safe" }, toolResult: "safe" }],
    });
    const adapter = new FakeEngineAdapter(script);
    const handle = adapter.spawn(
      buildTaskPacket(),
      buildEchoAllowedProfile(),
      alwaysAllowAdjudicate,
    );
    const events = await collect(handle.events);

    expect(events.map((e) => e.type)).toEqual(["init", "toolUse", "result"]);
    const init = events[0];
    expect(init?.type === "init" && init.sessionId).toBe(script.sessionId);
    const toolUse = events[1] as EngineToolUseEvent;
    expect(toolUse.toolName).toBe("Bash");
    expect(toolUse.toolResult).toBe("safe");
    const result = events[2] as EngineResultEvent;
    expect(result.permissionDenials).toEqual([]);
    expect(result.isError).toBe(false);
  });

  it("a permission-denied tool call never emits a toolUse event, only appears in the terminal result's permissionDenials", async () => {
    const script = buildFakeEngineScript({
      toolCalls: [{ toolName: "Write", toolInput: { file_path: "/tmp/x" } }],
    });
    const adapter = new FakeEngineAdapter(script);
    const handle = adapter.spawn(buildTaskPacket(), buildRealProfile(), alwaysAllowAdjudicate);
    const events = await collect(handle.events);

    expect(events.some((e) => e.type === "toolUse")).toBe(false);
    const result = events.find((e): e is EngineResultEvent => e.type === "result");
    expect(result?.permissionDenials).toEqual([
      { toolName: "Write", toolInput: { file_path: "/tmp/x" } },
    ]);
  });

  it("emits multiple toolUse events in scripted order for multiple allowed calls", async () => {
    const script = buildFakeEngineScript({
      toolCalls: [
        { toolName: "Bash", toolInput: { command: "npm run test" } },
        { toolName: "Bash", toolInput: { command: "git status" } },
      ],
    });
    const adapter = new FakeEngineAdapter(script);
    const handle = adapter.spawn(
      buildTaskPacket(),
      compileEnvelope(buildAuthorizationEnvelope({ commands: ["npm run test", "git status"] })),
      alwaysAllowAdjudicate,
    );
    const events = await collect(handle.events);
    const toolUseEvents = events.filter((e): e is EngineToolUseEvent => e.type === "toolUse");
    expect(toolUseEvents.map((e) => (e.toolInput as { command: string }).command)).toEqual([
      "npm run test",
      "git status",
    ]);
  });

  it("the normal-path terminal result's structuredOutput conforms to WorkerResultSchema (deliverable 1)", async () => {
    const script = buildFakeEngineScript();
    const adapter = new FakeEngineAdapter(script);
    const handle = adapter.spawn(buildTaskPacket(), buildRealProfile(), alwaysAllowAdjudicate);
    const events = await collect(handle.events);
    const result = events.find((e): e is EngineResultEvent => e.type === "result");
    expect(() => WorkerResultSchema.parse(result?.structuredOutput)).not.toThrow();
  });
});

describe("FakeEngineAdapter — capabilities()", () => {
  it("returns exactly the five EngineCapabilities fields", () => {
    const adapter = new FakeEngineAdapter(buildFakeEngineScript());
    const caps = adapter.capabilities();
    expect(Object.keys(caps).sort()).toEqual(
      [
        "engineVersion",
        "permissionModel",
        "sandboxModel",
        "supportsJsonSchema",
        "supportsSessionResume",
      ].sort(),
    );
  });
});

describe("FakeEngineAdapter — sessionRef scoping (resume)", () => {
  it("resume() rejects a sessionRef whose scope doesn't match the original spawn (fail-closed scoping)", async () => {
    const script = buildFakeEngineScript({ onResume: buildFakeEngineScript() });
    const adapter = new FakeEngineAdapter(script);
    const handle = adapter.spawn(buildTaskPacket(), buildRealProfile(), alwaysAllowAdjudicate);
    await collect(handle.events);

    const mismatched: SessionRef = { ...handle.sessionRef, worktreePath: "/some/other/worktree" };
    expect(() => adapter.resume(mismatched, alwaysAllowAdjudicate)).toThrow();
  });

  it("resume() rejects an entirely unknown sessionId", () => {
    const adapter = new FakeEngineAdapter(buildFakeEngineScript());
    expect(() =>
      adapter.resume(
        {
          sessionId: "never-spawned",
          projectDirectory: "/x",
          worktreePath: "/x/w",
          configDir: "/x/c",
        },
        alwaysAllowAdjudicate,
      ),
    ).toThrow();
  });

  it("resume() with a matching sessionRef continues via the script's onResume continuation", async () => {
    const resumeScript = buildFakeEngineScript({ assistantText: "42" });
    const script = buildFakeEngineScript({ onResume: resumeScript });
    const adapter = new FakeEngineAdapter(script);
    const handle = adapter.spawn(buildTaskPacket(), buildRealProfile(), alwaysAllowAdjudicate);
    await collect(handle.events);

    const resumedHandle = adapter.resume(handle.sessionRef, alwaysAllowAdjudicate);
    const events = await collect(resumedHandle.events);
    const assistantEvent = events.find((e) => e.type === "assistant");
    expect(assistantEvent && assistantEvent.type === "assistant" && assistantEvent.text).toBe("42");
  });
});
