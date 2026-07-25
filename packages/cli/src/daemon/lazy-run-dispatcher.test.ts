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
 *   + @eo/journal / @eo/supervisor / @eo/contracts .  65.5 MiB
 *   + run-dispatcher (pulls @eo/engine-claude,
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
import type { RunDispatcher } from "@eo/supervisor";
import {
  createLazyRunDispatcher,
  loadRunDispatcherModule,
  type RunDispatcherModule,
} from "./lazy-run-dispatcher.js";
import type { RealRunDispatcherOptions } from "./run-dispatcher.js";

/** The options bundle is passed straight through; nothing here inspects it. */
const OPTIONS = { projectDir: "/nowhere" } as unknown as RealRunDispatcherOptions;

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
    const stub = stubModule({ dispatch });
    const load = vi.fn(stub.load);

    const outcome = await createLazyRunDispatcher(OPTIONS, load).dispatch("run-1");

    expect(load).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith("run-1");
    expect(outcome).toEqual({ accepted: true });
  });

  it("builds exactly ONE real dispatcher across many dispatches, so per-run idempotency holds", async () => {
    const dispatch = vi.fn(() => Promise.resolve({ accepted: true as const }));
    const stub = stubModule({ dispatch });
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
    const stub = stubModule({ dispatch });
    const load = vi.fn(stub.load);
    const lazy = createLazyRunDispatcher(OPTIONS, load);

    await Promise.all([lazy.dispatch("run-1"), lazy.dispatch("run-2")]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(stub.created()).toBe(1);
  });

  it("propagates a load failure and does not poison the dispatcher against a later retry", async () => {
    const dispatch = vi.fn(() => Promise.resolve({ accepted: true as const }));
    const stub = stubModule({ dispatch });
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
