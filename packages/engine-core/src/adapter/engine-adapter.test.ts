import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, TaskPacketSchema, type TaskPacket } from "@eo/contracts";
import type { AdjudicationDecision } from "./adjudication.js";
import type { EngineAdapter } from "./engine-adapter.js";
import { StubEngineAdapter } from "./stub-engine-adapter.js";
import { compileEnvelope } from "../compiler/compile-envelope.js";
import { buildEnvelopeFixture } from "../compiler/envelope-fixture.js";

/**
 * `EngineAdapter` stub-conformance test (roadmap/03-envelope-compiler-
 * engine-adapter.md work item 1: "a stub-conformance test asserting a
 * minimal stub adapter satisfies the interface"). `StubEngineAdapter`
 * type-checking against `EngineAdapter` (the `const adapter: EngineAdapter
 * = new StubEngineAdapter()` line below) IS the structural conformance
 * proof — `npx tsc -b packages/engine-core` fails to compile if the stub
 * ever stops satisfying the interface. The runtime assertions below are
 * this file's own genuine assertion-level checks on top of that.
 */

const TASK_PACKET_FIXTURE: TaskPacket = TaskPacketSchema.parse({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
  workUnitId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  requirementIds: [],
  objective: "Stub objective for EngineAdapter conformance testing.",
  nonGoals: [],
  baseObjectId: "deadbeefcafebabe0000000000000000000000",
  relevantInterfaces: [],
  ownedPaths: [],
  constraints: [],
  resourceLimits: { maxTurns: 10 },
  gates: [],
  resultSchema: {},
});

const COMPILED_PROFILE_FIXTURE = compileEnvelope(buildEnvelopeFixture());

const ALLOW_EVERYTHING: AdjudicationDecision = { behavior: "allow", updatedInput: {} };

describe("EngineAdapter — stub conformance (roadmap/03 work item 1 failing-first fixture)", () => {
  const adapter: EngineAdapter = new StubEngineAdapter();

  it("spawn returns a WorkerHandle with a string sessionRef.sessionId and an async-iterable events stream", () => {
    const handle = adapter.spawn(TASK_PACKET_FIXTURE, COMPILED_PROFILE_FIXTURE, () =>
      Promise.resolve(ALLOW_EVERYTHING),
    );
    expect(typeof handle.sessionRef.sessionId).toBe("string");
    expect(handle.sessionRef.sessionId.length).toBeGreaterThan(0);
    expect(typeof handle.events[Symbol.asyncIterator]).toBe("function");
  });

  it("resume returns a WorkerHandle carrying the exact sessionRef it was given", () => {
    const sessionRef = {
      sessionId: "s1",
      projectDirectory: "/p",
      worktreePath: "/p/worktree",
      configDir: "/p/claude-config",
    };
    const handle = adapter.resume(sessionRef, () => Promise.resolve(ALLOW_EVERYTHING));
    expect(handle.sessionRef).toEqual(sessionRef);
  });

  it("cancel resolves without throwing", async () => {
    const handle = adapter.spawn(TASK_PACKET_FIXTURE, COMPILED_PROFILE_FIXTURE, () =>
      Promise.resolve(ALLOW_EVERYTHING),
    );
    await expect(adapter.cancel(handle, "2026-07-17T00:00:00.000Z")).resolves.toBeUndefined();
  });

  it("capabilities() returns a truthy object (key-shape asserted in engine-capabilities.test.ts)", () => {
    expect(adapter.capabilities()).toBeTruthy();
  });

  it("an empty scripted event stream is a valid, iterable async sequence", async () => {
    const handle = adapter.spawn(TASK_PACKET_FIXTURE, COMPILED_PROFILE_FIXTURE, () =>
      Promise.resolve(ALLOW_EVERYTHING),
    );
    const events = [];
    for await (const event of handle.events) {
      events.push(event);
    }
    expect(events).toEqual([]);
  });
});
