import { describe, expect, it } from "vitest";
import {
  compileEnvelope,
  type AdjudicationCallback,
  type CompiledWorkerProfile,
  type EngineEvent,
  type EngineResultEvent,
} from "@eo/engine-core";
import { buildAuthorizationEnvelope } from "../fixtures/authorization-envelope.js";
import { buildTaskPacket } from "../fixtures/task-packet.js";
import { alwaysThrowAdjudicate } from "./adjudication-layer.js";
import { buildFakeEngineScript } from "./scripted-trace.js";
import { FakeEngineAdapter } from "./fake-engine-adapter.js";

/**
 * The mandatory adjudication-hook-bypass security test, exercised through
 * the PUBLIC `spawn` surface (roadmap/03-envelope-compiler-engine-
 * adapter.md §Test plan, Security bullet: "an adjudication-hook-bypass
 * test (fake engine attempts a tool call with no `AdjudicationCallback`
 * supplied, or one that throws) must fail closed, never open"). See
 * `docs/evidence/phase-03/wi5-fake-engine-failing.txt`.
 */
function buildEchoAllowedProfile(): CompiledWorkerProfile {
  const base = compileEnvelope(buildAuthorizationEnvelope());
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

describe("FakeEngineAdapter — adjudication-hook-bypass fail-closed (security)", () => {
  it("a scripted tool call adjudicated by a THROWING callback is denied, never executed", async () => {
    const script = buildFakeEngineScript({
      toolCalls: [{ toolName: "Bash", toolInput: { command: "echo hi" } }],
    });
    const adapter = new FakeEngineAdapter(script);
    // the permission layer alone WOULD allow this call — proving the denial
    // comes from the adjudication layer's fail-closed behavior, not a
    // permission-layer coincidence.
    const handle = adapter.spawn(
      buildTaskPacket(),
      buildEchoAllowedProfile(),
      alwaysThrowAdjudicate,
    );
    const events = await collect(handle.events);

    expect(events.some((e) => e.type === "toolUse")).toBe(false);
    const result = events.find((e): e is EngineResultEvent => e.type === "result");
    expect(result?.permissionDenials).toEqual([
      { toolName: "Bash", toolInput: { command: "echo hi" } },
    ]);
  });

  it("a spawn() call given no adjudicate callback at all (runtime bypass of the required parameter) fails closed", async () => {
    const script = buildFakeEngineScript({
      toolCalls: [{ toolName: "Bash", toolInput: { command: "echo hi" } }],
    });
    const adapter = new FakeEngineAdapter(script);
    const handle = adapter.spawn(
      buildTaskPacket(),
      buildEchoAllowedProfile(),
      undefined as unknown as AdjudicationCallback,
    );
    const events = await collect(handle.events);

    expect(events.some((e) => e.type === "toolUse")).toBe(false);
    const result = events.find((e): e is EngineResultEvent => e.type === "result");
    expect(result?.permissionDenials).toEqual([
      { toolName: "Bash", toolInput: { command: "echo hi" } },
    ]);
  });

  it("resume() with a throwing callback also fails closed for the resumed session's own scripted calls", async () => {
    const resumeScript = buildFakeEngineScript({
      toolCalls: [{ toolName: "Bash", toolInput: { command: "echo hi" } }],
    });
    const script = buildFakeEngineScript({ onResume: resumeScript });
    const adapter = new FakeEngineAdapter(script);
    const spawnHandle = adapter.spawn(
      buildTaskPacket(),
      buildEchoAllowedProfile(),
      alwaysThrowAdjudicate,
    );
    await collect(spawnHandle.events);

    const resumedHandle = adapter.resume(spawnHandle.sessionRef, alwaysThrowAdjudicate);
    const resumedEvents = await collect(resumedHandle.events);
    expect(resumedEvents.some((e) => e.type === "toolUse")).toBe(false);
  });
});
