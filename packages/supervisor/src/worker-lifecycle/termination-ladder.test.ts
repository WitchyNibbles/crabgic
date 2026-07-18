/**
 * roadmap/05-supervisor-daemon.md work item 4 failing-first target: "a
 * killed fake worker stays unreaped against a stub lifecycle manager
 * before the ladder/reaper exists." Exercised against `@eo/testkit`'s real
 * `FakeEngineAdapter` (no mocked transport for the adapter contract
 * itself) with its `hang` failure-mode injection.
 */
import { describe, expect, it } from "vitest";
import { buildFakeEngineScript, buildTaskPacket, FakeEngineAdapter } from "@eo/testkit";
import type { EngineAdapter, EngineEvent, WorkerHandle } from "@eo/engine-core";
import { terminateWorker } from "./termination-ladder.js";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "./test-support/minimal-compiled-profile.js";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      t.unref?.();
    }),
  ]);
}

/**
 * A deliberately MISBEHAVING `EngineAdapter` double, used ONLY by the
 * "forced escalation" test below: `cancel()` resolves but has NO effect on
 * the worker's own `events` stream (which hangs forever, unconditionally).
 * `@eo/testkit`'s real `FakeEngineAdapter.cancel()` always cooperates (its
 * own "hang" failure mode reliably unblocks the instant `cancel()` is
 * called) — proving genuine step-3 (SIGKILL-equivalent, forced iterator
 * abandonment) behavior therefore requires an adapter that does NOT
 * cooperate, which is exactly the resilience property this ladder must
 * hold even when the underlying `EngineAdapter` implementation fails to
 * honor its own `cancel(handle, deadline)` contract.
 */
class NonCooperativeAdapter implements EngineAdapter {
  spawn(): WorkerHandle {
    async function* foreverHang(): AsyncGenerator<EngineEvent> {
      yield { type: "init", sessionId: "s1", model: "m", cwd: "/", tools: [], mcpServers: [] };
      await new Promise<never>(() => {
        // Never resolves — this generator never advances past this point,
        // regardless of how many times cancel() is called.
      });
    }
    return {
      sessionRef: {
        sessionId: "s1",
        projectDirectory: "/p",
        worktreePath: "/p/w",
        configDir: "/p/c",
      },
      events: foreverHang(),
    };
  }
  resume(): WorkerHandle {
    throw new Error("not used by this test");
  }
  async cancel(): Promise<void> {
    // Deliberately a no-op — see class doc comment.
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

describe("terminateWorker — SIGTERM -> grace -> SIGKILL ladder", () => {
  it("reaps a worker whose adapter fails to honor cancel() within the grace deadline (forced escalation), never staying stuck forever", async () => {
    const adapter = new NonCooperativeAdapter();
    const handle = adapter.spawn();
    const iterator: AsyncIterator<EngineEvent> = handle.events[Symbol.asyncIterator]();

    // A live consumer is already mid-stream (the normal operating
    // condition) — pull the "init" event first.
    const first = await iterator.next();
    expect(first.done).toBe(false);

    // The whole point of this test: it must never hang. A generous overall
    // timeout proves the ladder itself converges; the tight `graceMs`
    // proves the ESCALATION (not just eventual completion) happened.
    const result = await withTimeout(
      terminateWorker({ adapter, handle, iterator, graceMs: 50 }),
      3_000,
      "terminateWorker",
    );
    expect(result.outcome).toBe("forced");
    // Deliberately NOT asserting the generator itself reaches `done` here:
    // `NonCooperativeAdapter`'s generator is stuck on an `await` that will
    // NEVER settle — no JS-level mechanism can force it to complete (see
    // `terminateWorker`'s own step-3 doc comment). "Reaped" at this
    // abstraction layer means the SUPERVISOR gives up waiting and moves on
    // (proven by `result.outcome === "forced"` resolving within the
    // bounded `withTimeout` above), independent of whatever the
    // underlying, misbehaving generator does afterward.
  });

  it("reaps a hung fake-engine worker gracefully once its adapter's own cancel() cooperates (the fake engine's real hang-mode behavior)", async () => {
    const script = buildFakeEngineScript({ failure: { kind: "hang", atStepIndex: 0 } });
    const adapter = new FakeEngineAdapter(script);
    const profile = buildMinimalCompiledProfile();
    const handle = adapter.spawn(buildTaskPacket(), profile, allowAllAdjudicate);
    const iterator: AsyncIterator<EngineEvent> = handle.events[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.done).toBe(false);

    const result = await withTimeout(
      terminateWorker({ adapter, handle, iterator, graceMs: 2_000 }),
      3_000,
      "terminateWorker",
    );
    // The fake engine's cancel() unblocks its hang gate immediately, so
    // this converges well inside the grace window — "graceful," not
    // "forced." (The forced/SIGKILL path is covered by the
    // NonCooperativeAdapter test above, which the fake engine's own
    // cooperative cancel() semantics cannot exercise.)
    expect(result.outcome).toBe("graceful");

    const after = await withTimeout(iterator.next(), 500, "post-terminate iterator.next()");
    expect(after.done).toBe(true);
  });

  it("reports graceful when the worker's own events stream ends on its own inside the grace window", async () => {
    const script = buildFakeEngineScript(); // default script completes quickly with no failure mode
    const adapter = new FakeEngineAdapter(script);
    const profile = buildMinimalCompiledProfile();
    const handle = adapter.spawn(buildTaskPacket(), profile, allowAllAdjudicate);
    const iterator: AsyncIterator<EngineEvent> = handle.events[Symbol.asyncIterator]();

    const result = await withTimeout(
      terminateWorker({ adapter, handle, iterator, graceMs: 2_000 }),
      3_000,
      "terminateWorker",
    );
    expect(result.outcome).toBe("graceful");
  });
});
