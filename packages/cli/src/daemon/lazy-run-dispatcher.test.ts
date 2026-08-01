/**
 * The lazy `RunDispatcher` — what keeps the engine out of an idle daemon.
 *
 * roadmap/05 §Idle resource budget fixes the daemon at "<100 MiB RSS", and
 * the phase summary states the intent plainly: it "holds its own idle
 * footprint to a fixed, CI-measured budget SO RUNNING IT COSTS NOTHING WHEN
 * THERE IS NO WORK."
 *
 * Measured on this host (Node 24.18.0), eager loading breached that:
 *
 *   bare Node runtime floor .......................  41.2 MiB
 *   + @crabgic/journal / @crabgic/supervisor / @crabgic/contracts .  65.5 MiB
 *   + run-dispatcher (pulls @crabgic/engine-claude,
 *     which pulls @anthropic-ai/claude-agent-sdk) .. 108.2 MiB
 *
 * The daemon's own idle RSS was 99.8 / 108.2 / 100.2 MiB across three boots
 * — straddling the budget. It is byte-for-byte FLAT once booted (101816 kB
 * from t=1s through t=16s), so this was never a leak: the whole footprint
 * is module loading, and ~41 MiB of it is an engine that an idle daemon
 * never calls. A daemon serving only status/cancel/evidence/registry has no
 * use for the engine at all.
 *
 * Deferring the import is safe because `dispatch` is already async and
 * resolves on OWNERSHIP, not completion — and a run takes hours, so a
 * one-time module load on the first dispatch is immaterial against it.
 *
 * The single-instance guarantee below is a correctness property, not an
 * optimization: `createRealRunDispatcher` tracks in-flight runs in
 * per-instance state to stay idempotent per run. Two instances would each
 * keep their own, and a repeated `run.dispatch` could start a second
 * competing driver over the same work units.
 */
import { describe, expect, it, vi } from "vitest";
import { DISPATCHER_DRAINING_REASON, type RunDispatcher } from "@crabgic/supervisor";
import {
  createLazyRunDispatcher,
  loadRunDispatcherModule,
  type RunDispatcherModule,
} from "./lazy-run-dispatcher.js";
import type { RealRunDispatcherOptions } from "./run-dispatcher.js";

/** The options bundle is passed straight through; nothing here inspects it. */
const OPTIONS = { projectDir: "/nowhere" } as unknown as RealRunDispatcherOptions;

/**
 * Fills in whichever `RunDispatcher` method a case does not exercise.
 * `resume` was split out of `dispatch` on 2026-07-28 (ledger Gap 18) and
 * `drain` was added for graceful shutdown; these cases are about the LAZY
 * LOADING contract, not about any method's own semantics, so they should not
 * have to restate all three.
 */
function asDispatcher(partial: Partial<RunDispatcher>): RunDispatcher {
  return {
    dispatch: () => Promise.resolve({ accepted: true }),
    resume: () => Promise.resolve({ accepted: true }),
    drain: () => Promise.resolve({ settledRunIds: [], cancelledRunIds: [], unsettledRunIds: [] }),
    ...partial,
  };
}

function stubModule(dispatcher: RunDispatcher): {
  readonly load: () => Promise<RunDispatcherModule>;
  readonly created: () => number;
} {
  let created = 0;
  return {
    load: () =>
      Promise.resolve({
        createRealRunDispatcher: () => {
          created += 1;
          return dispatcher;
        },
      }),
    created: () => created,
  };
}

describe("createLazyRunDispatcher", () => {
  it("does NOT load the engine-bearing module at construction — the whole point", () => {
    const load = vi.fn<() => Promise<RunDispatcherModule>>();

    createLazyRunDispatcher(OPTIONS, load);

    expect(load).not.toHaveBeenCalled();
  });

  it("loads on first dispatch and delegates the runId, returning the real outcome", async () => {
    const dispatch = vi.fn(() => Promise.resolve({ accepted: true as const }));
    const stub = stubModule(asDispatcher({ dispatch }));
    const load = vi.fn(stub.load);

    const outcome = await createLazyRunDispatcher(OPTIONS, load).dispatch("run-1");

    expect(load).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith("run-1");
    expect(outcome).toEqual({ accepted: true });
  });

  it("builds exactly ONE real dispatcher across many dispatches, so per-run idempotency holds", async () => {
    const dispatch = vi.fn(() => Promise.resolve({ accepted: true as const }));
    const stub = stubModule(asDispatcher({ dispatch }));
    const load = vi.fn(stub.load);
    const lazy = createLazyRunDispatcher(OPTIONS, load);

    await lazy.dispatch("run-1");
    await lazy.dispatch("run-2");
    await lazy.dispatch("run-3");

    expect(load).toHaveBeenCalledTimes(1);
    expect(stub.created()).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it("shares a single load across CONCURRENT first dispatches rather than racing two instances", async () => {
    const dispatch = vi.fn(() => Promise.resolve({ accepted: true as const }));
    const stub = stubModule(asDispatcher({ dispatch }));
    const load = vi.fn(stub.load);
    const lazy = createLazyRunDispatcher(OPTIONS, load);

    await Promise.all([lazy.dispatch("run-1"), lazy.dispatch("run-2")]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(stub.created()).toBe(1);
  });

  /**
   * Shutdown must not be the thing that finally pays the 40.9 MiB import. A
   * daemon that only ever served status/evidence reads has no drive to wait
   * for, and loading the engine to ask "nothing in flight, right?" would spend
   * the entire idle-footprint budget at the one moment it can buy nothing.
   */
  it("drains without loading the module when nothing was ever dispatched", async () => {
    const load = vi.fn<() => Promise<RunDispatcherModule>>();

    const outcome = await createLazyRunDispatcher(OPTIONS, load).drain({ timeoutMs: 1 });

    expect(load).not.toHaveBeenCalled();
    expect(outcome).toEqual({ settledRunIds: [], cancelledRunIds: [], unsettledRunIds: [] });
  });

  /**
   * THE ONE-WAY DOOR HAS TO LATCH IN THIS WRAPPER, not only in the dispatcher
   * behind it — this is the object `bin/supervisord.ts` actually composes, so
   * this is where `RunDispatcher.drain`'s "refuses permanently" contract is
   * either kept or not.
   *
   * Delegation alone did not keep it. Draining a NEVER-LOADED dispatcher
   * returns the empty outcome and touches nothing, so a later `dispatch` would
   * load the engine and be ACCEPTED — a drive started after the caller had
   * decided the daemon was quiescing, and after the boot layer may already
   * have released the single-writer lease. Unreachable through today's
   * composed daemon (the control plane is closed first, and the UDS close
   * waits for its connections), which is exactly why it needs a test rather
   * than an argument.
   */
  it("drain on a never-loaded dispatcher still shuts the door: a later dispatch is refused and the engine is never loaded", async () => {
    const load = vi.fn<() => Promise<RunDispatcherModule>>();
    const lazy = createLazyRunDispatcher(OPTIONS, load);

    await lazy.drain({ timeoutMs: 1 });

    expect(await lazy.dispatch("change-set-1")).toEqual({
      accepted: false,
      reason: DISPATCHER_DRAINING_REASON,
    });
    expect(await lazy.resume("run-1")).toEqual({
      accepted: false,
      reason: DISPATCHER_DRAINING_REASON,
    });
    // Still never loaded: a drained daemon must not import 40.9 MiB of engine
    // just to discover it is drained.
    expect(load).not.toHaveBeenCalled();
  });

  /** And once one HAS been built, the wrapper refuses without even reaching it. */
  it("refuses after draining a loaded dispatcher, without delegating the call", async () => {
    const dispatch = vi.fn(() => Promise.resolve({ accepted: true as const }));
    const resume = vi.fn(() => Promise.resolve({ accepted: true as const }));
    const stub = stubModule(asDispatcher({ dispatch, resume }));
    const lazy = createLazyRunDispatcher(OPTIONS, vi.fn(stub.load));

    await lazy.dispatch("change-set-1");
    await lazy.drain({ timeoutMs: 1 });

    expect((await lazy.dispatch("change-set-1")).reason).toBe(DISPATCHER_DRAINING_REASON);
    expect((await lazy.resume("run-1")).reason).toBe(DISPATCHER_DRAINING_REASON);
    expect(dispatch).toHaveBeenCalledTimes(1); // the pre-drain one only
    expect(resume).not.toHaveBeenCalled();
  });

  it("drains the real dispatcher once one exists, forwarding the deadline", async () => {
    const drain = vi.fn(() =>
      Promise.resolve({
        settledRunIds: ["run-1"],
        cancelledRunIds: [],
        unsettledRunIds: [],
      }),
    );
    const stub = stubModule(asDispatcher({ drain }));
    const lazy = createLazyRunDispatcher(OPTIONS, vi.fn(stub.load));

    await lazy.dispatch("run-1");
    const outcome = await lazy.drain({ timeoutMs: 7, graceMs: 3 });

    expect(drain).toHaveBeenCalledWith({ timeoutMs: 7, graceMs: 3 });
    expect(outcome.settledRunIds).toEqual(["run-1"]);
  });

  it("propagates a load failure and does not poison the dispatcher against a later retry", async () => {
    const dispatch = vi.fn(() => Promise.resolve({ accepted: true as const }));
    const stub = stubModule(asDispatcher({ dispatch }));
    const load = vi
      .fn<() => Promise<RunDispatcherModule>>()
      .mockRejectedValueOnce(new Error("module load failed"))
      .mockImplementation(stub.load);
    const lazy = createLazyRunDispatcher(OPTIONS, load);

    await expect(lazy.dispatch("run-1")).rejects.toThrow("module load failed");
    await expect(lazy.dispatch("run-1")).resolves.toEqual({ accepted: true });
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("loadRunDispatcherModule", () => {
  /**
   * Guards the specifier the production default depends on. Making the
   * import lazy removed the compile-time and boot-time checks that it
   * resolves; without this test a wrong path would first surface as a
   * failed `run.dispatch` on a live daemon.
   */
  it("resolves the real module and exposes createRealRunDispatcher", async () => {
    const module = await loadRunDispatcherModule();

    expect(typeof module.createRealRunDispatcher).toBe("function");
  });
});
