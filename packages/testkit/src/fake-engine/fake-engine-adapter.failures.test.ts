import { describe, expect, it } from "vitest";
import {
  compileEnvelope,
  type CompiledWorkerProfile,
  type EngineEvent,
  type EngineResultEvent,
} from "@eo/engine-core";
import { TimestampSchema } from "@eo/contracts";
import { buildAuthorizationEnvelope } from "../fixtures/authorization-envelope.js";
import { buildTaskPacket } from "../fixtures/task-packet.js";
import { alwaysAllowAdjudicate } from "./adjudication-layer.js";
import { buildFakeEngineScript } from "./scripted-trace.js";
import { FakeEngineAdapter } from "./fake-engine-adapter.js";
import { RATE_LIMIT_ALLOWED_WARNING_98 } from "./rate-limit-fixtures.js";

/**
 * Injectable failure modes, each exercised through the adapter's public
 * `spawn`/`resume`/`cancel` surface (roadmap/03-envelope-compiler-engine-
 * adapter.md §Test plan, Integration bullet: "each injectable failure mode
 * ... exercised through the adapter's public spawn/resume/cancel surface,
 * not internal calls").
 */
function buildRealProfile(): CompiledWorkerProfile {
  return compileEnvelope(buildAuthorizationEnvelope());
}

async function collect(events: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("FakeEngineAdapter — crash injection (docs/engine-baseline.md §7 kill9 shape)", () => {
  it("the event stream ends abruptly with no terminal result event", async () => {
    const script = buildFakeEngineScript({
      toolCalls: [{ toolName: "Bash", toolInput: { command: "sleep 8" } }],
      failure: { kind: "crash", atStepIndex: 0 },
    });
    const adapter = new FakeEngineAdapter(script);
    const handle = adapter.spawn(buildTaskPacket(), buildRealProfile(), alwaysAllowAdjudicate);
    const events = await collect(handle.events);

    expect(events.map((e) => e.type)).toEqual(["init"]);
    expect(events.some((e) => e.type === "result")).toBe(false);
  });

  it("resume() continues a crashed session to a normal terminal result (kill9-resume shape)", async () => {
    const resumeScript = buildFakeEngineScript({ assistantText: "42" });
    const crashScript = buildFakeEngineScript({
      toolCalls: [{ toolName: "Bash", toolInput: { command: "sleep 8" } }],
      failure: { kind: "crash", atStepIndex: 0 },
      onResume: resumeScript,
    });
    const adapter = new FakeEngineAdapter(crashScript);
    const handle = adapter.spawn(buildTaskPacket(), buildRealProfile(), alwaysAllowAdjudicate);
    const crashedEvents = await collect(handle.events);
    expect(crashedEvents.some((e) => e.type === "result")).toBe(false);

    const resumedHandle = adapter.resume(handle.sessionRef, alwaysAllowAdjudicate);
    const resumedEvents = await collect(resumedHandle.events);
    const result = resumedEvents.find((e): e is EngineResultEvent => e.type === "result");
    expect(result).toBeDefined();
    expect(result?.isError).toBe(false);
  });
});

describe("FakeEngineAdapter — limitSignal injection (docs/engine-baseline.md §8 verbatim schema)", () => {
  it("replays a verbatim recorded rate_limit_event payload mid-stream, then completes normally", async () => {
    const script = buildFakeEngineScript({
      failure: { kind: "limitSignal", payload: RATE_LIMIT_ALLOWED_WARNING_98 },
    });
    const adapter = new FakeEngineAdapter(script);
    const handle = adapter.spawn(buildTaskPacket(), buildRealProfile(), alwaysAllowAdjudicate);
    const events = await collect(handle.events);

    const limitEvent = events.find((e) => e.type === "limitSignal");
    expect(limitEvent && limitEvent.type === "limitSignal" && limitEvent.status).toBe(
      "allowed_warning",
    );
    expect(limitEvent && limitEvent.type === "limitSignal" && limitEvent.utilization).toBe(0.98);
    expect(events.some((e) => e.type === "result")).toBe(true);
  });
});

describe("FakeEngineAdapter — schema-violating result injection (docs/engine-baseline.md §5 exact observed shape)", () => {
  it("terminal result is success-shaped with structuredOutput undefined, no retry event, no error", async () => {
    const script = buildFakeEngineScript({ failure: { kind: "schemaViolation" } });
    const adapter = new FakeEngineAdapter(script);
    const handle = adapter.spawn(buildTaskPacket(), buildRealProfile(), alwaysAllowAdjudicate);
    const events = await collect(handle.events);

    const result = events.find((e): e is EngineResultEvent => e.type === "result");
    expect(result?.subtype).toBe("success");
    expect(result?.isError).toBe(false);
    expect(result?.structuredOutput).toBeUndefined();
    expect(events.filter((e) => e.type === "retry")).toHaveLength(0);
  });
});

describe("FakeEngineAdapter — hang/timeout injection via cancel(handle, deadline)", () => {
  it("the stream blocks until cancel() resolves it, then ends with no result event", async () => {
    const script = buildFakeEngineScript({
      toolCalls: [{ toolName: "Bash", toolInput: { command: "echo hi" } }],
      failure: { kind: "hang", atStepIndex: 0 },
    });
    const adapter = new FakeEngineAdapter(script);
    const handle = adapter.spawn(buildTaskPacket(), buildRealProfile(), alwaysAllowAdjudicate);
    const iterator = handle.events[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect((first.value as EngineEvent).type).toBe("init");

    const TIMEOUT_SENTINEL = Symbol("timeout");
    const raced = await Promise.race([
      iterator.next(),
      new Promise((resolve) => setTimeout(() => resolve(TIMEOUT_SENTINEL), 50)),
    ]);
    expect(raced).toBe(TIMEOUT_SENTINEL);

    await adapter.cancel(handle, TimestampSchema.parse("2026-07-18T00:00:00.000Z"));

    const afterCancel = await iterator.next();
    expect(afterCancel.done).toBe(true);
  });

  it("cancel() never throws for an already-terminated handle", async () => {
    const script = buildFakeEngineScript();
    const adapter = new FakeEngineAdapter(script);
    const handle = adapter.spawn(buildTaskPacket(), buildRealProfile(), alwaysAllowAdjudicate);
    await collect(handle.events);
    await expect(
      adapter.cancel(handle, TimestampSchema.parse("2026-07-18T00:00:00.000Z")),
    ).resolves.toBeUndefined();
  });
});
