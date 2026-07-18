import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, getLatestAttempt, type JournalStore } from "@eo/journal";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
} from "@eo/testkit";
import type { EngineAdapter, EngineEvent, WorkerHandle } from "@eo/engine-core";
import { spawnManagedWorker } from "./worker-lifecycle-manager.js";
import { createWorkersRegistry } from "../registries/workers-registry.js";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "./test-support/minimal-compiled-profile.js";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-supervisor-worker-lifecycle-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("spawnManagedWorker", () => {
  it("journals session_assignment before consuming events, registers the worker, and records a dispatched attempt", async () => {
    // A "hang" script deliberately never reaches a terminal result event,
    // giving this test a deterministic window to observe spawn-time-only
    // state (session_assignment/registration/dispatched attempt) without
    // racing the background event pump's own eventual settlement.
    const script = buildFakeEngineScript({ failure: { kind: "hang", atStepIndex: 0 } });
    const adapter = new FakeEngineAdapter(script);
    const workers = createWorkersRegistry();
    const packet = buildTaskPacket({ workUnitId: "11111111-1111-4111-8111-111111111111" });

    const managed = await spawnManagedWorker({
      adapter,
      journal: store,
      workers,
      packet,
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
    });

    const sessionEntries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "session_assignment" })) {
      sessionEntries.push(entry);
    }
    expect(sessionEntries).toHaveLength(1);
    expect(workers.get(managed.workerId)?.status).toBe("starting");

    const dispatchedAttempt = await getLatestAttempt(store, packet.workUnitId);
    expect(dispatchedAttempt?.status).toBe("dispatched");

    // Clean shutdown so no floating background work outlives this test.
    await managed.terminate(20);
    await managed.settled;
  });

  it("settles 'succeeded' and marks the worker terminated for a clean successful script", async () => {
    const script = buildFakeEngineScript({
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const adapter = new FakeEngineAdapter(script);
    const workers = createWorkersRegistry();
    const packet = buildTaskPacket();

    const managed = await spawnManagedWorker({
      adapter,
      journal: store,
      workers,
      packet,
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
    });

    const outcome = await managed.settled;
    expect(outcome).toBe("succeeded");
    expect(workers.get(managed.workerId)?.status).toBe("terminated");

    const attempt = await getLatestAttempt(store, packet.workUnitId);
    expect(attempt?.status).toBe("succeeded");
  });

  it("settles 'crashed' and fires the recovery hook for an abrupt (no-result) stream end", async () => {
    const script = buildFakeEngineScript({ failure: { kind: "crash", atStepIndex: 0 } });
    const adapter = new FakeEngineAdapter(script);
    const workers = createWorkersRegistry();
    const packet = buildTaskPacket();
    const hookCalls: string[] = [];

    const managed = await spawnManagedWorker({
      adapter,
      journal: store,
      workers,
      packet,
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      onCrash: (worker) => {
        hookCalls.push(worker.workerId);
      },
    });

    const outcome = await managed.settled;
    expect(outcome).toBe("crashed");
    expect(workers.get(managed.workerId)?.status).toBe("crashed");
    expect(hookCalls).toEqual([managed.workerId]);

    const attempt = await getLatestAttempt(store, packet.workUnitId);
    expect(attempt?.status).toBe("failed");
  });

  it("settles 'succeeded' for a worker that self-reports 'cancelled' via structuredOutput.outcome", async () => {
    const script = buildFakeEngineScript({
      structuredOutput: buildWorkerResult({ outcome: "cancelled" }),
    });
    const adapter = new FakeEngineAdapter(script);
    const workers = createWorkersRegistry();
    const packet = buildTaskPacket();

    const managed = await spawnManagedWorker({
      adapter,
      journal: store,
      workers,
      packet,
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
    });

    const outcome = await managed.settled;
    expect(outcome).toBe("cancelled");
    const attempt = await getLatestAttempt(store, packet.workUnitId);
    expect(attempt?.status).toBe("cancelled");
  });

  it("treats a thrown events iterator identically to an abrupt (crashed) end", async () => {
    const THROWING_SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    class ThrowingAdapter implements EngineAdapter {
      spawn(): WorkerHandle {
        async function* throwing(): AsyncGenerator<EngineEvent> {
          yield {
            type: "init",
            sessionId: THROWING_SESSION_ID,
            model: "m",
            cwd: "/",
            tools: [],
            mcpServers: [],
          };
          throw new Error("simulated stream failure");
        }
        return {
          sessionRef: {
            sessionId: THROWING_SESSION_ID,
            projectDirectory: "/p",
            worktreePath: "/p/w",
            configDir: "/p/c",
          },
          events: throwing(),
        };
      }
      resume(): WorkerHandle {
        throw new Error("not used");
      }
      async cancel(): Promise<void> {
        // no-op
      }
      capabilities(): ReturnType<EngineAdapter["capabilities"]> {
        return {
          supportsJsonSchema: true,
          supportsSessionResume: false,
          permissionModel: "test",
          sandboxModel: "test",
          engineVersion: "0.0.0-test",
        };
      }
    }

    const workers = createWorkersRegistry();
    const packet = buildTaskPacket();
    const managed = await spawnManagedWorker({
      adapter: new ThrowingAdapter(),
      journal: store,
      workers,
      packet,
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
    });

    const outcome = await managed.settled;
    expect(outcome).toBe("crashed");
    expect(workers.get(managed.workerId)?.status).toBe("crashed");
  });

  it("feeds the ring buffer with every observed engine event", async () => {
    const script = buildFakeEngineScript();
    const adapter = new FakeEngineAdapter(script);
    const workers = createWorkersRegistry();

    const managed = await spawnManagedWorker({
      adapter,
      journal: store,
      workers,
      packet: buildTaskPacket(),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
    });

    await managed.settled;
    const sub = managed.logBuffer.subscribe();
    expect(sub.poll().length).toBeGreaterThan(0);
  });
});
