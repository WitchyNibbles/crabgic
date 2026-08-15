import { describe, expect, it, vi } from "vitest";
import {
  createParkResumeDriver,
  latestParkedByRun,
  runsReadyToResume,
  startParkResumeDriver,
  type AttemptTransition,
} from "./park-resume-driver.js";
import type { JournalStore } from "@crabgic/journal";

/**
 * The park-resume driver — from a defect the first real dispatch MEASURED
 * (2026-08-15, `docs/evidence/phase-25/first-real-dispatch.md`).
 *
 * A run that meets a rate limit parks correctly, retains its adapter
 * correctly, and journals a reset timer correctly. Nothing then reads that
 * timer back. Both times the caller of `resume` was a human, which is exactly
 * the "no human feedback is needed" property the pipeline is supposed to have.
 *
 * These tests are mostly about what the driver must NOT do: never resume a run
 * whose reset has not passed, never resume one that is not parked, and never
 * let one bad journal entry stop it reading the rest.
 */

const t = (
  seq: number,
  runId: string | undefined,
  workUnitId: string | undefined,
  status: string,
): AttemptTransition => ({ seq, runId, workUnitId, status });

describe("latestParkedByRun", () => {
  it("reports a unit whose LATEST transition is a rate-limit park", () => {
    const parked = latestParkedByRun([
      t(1, "run-a", "wu-1", "dispatched"),
      t(2, "run-a", "wu-1", "parked:rate_limit"),
    ]);
    expect([...parked.entries()]).toEqual([["run-a", ["wu-1"]]]);
  });

  /**
   * The load-bearing one. A park-timer marker stays in history forever, so a
   * driver keying off "a park was recorded" would re-resume a unit that has
   * since moved on — re-dispatching finished work.
   */
  it("does NOT report a unit that parked and then moved on", () => {
    const parked = latestParkedByRun([
      t(1, "run-a", "wu-1", "parked:rate_limit"),
      t(2, "run-a", "wu-1", "dispatched"),
      t(3, "run-a", "wu-1", "succeeded"),
    ]);
    expect(parked.size).toBe(0);
  });

  it("keeps units of different runs apart, and units within a run together", () => {
    const parked = latestParkedByRun([
      t(1, "run-a", "wu-1", "parked:rate_limit"),
      t(2, "run-a", "wu-2", "parked:rate_limit"),
      t(3, "run-b", "wu-3", "parked:rate_limit"),
      t(4, "run-b", "wu-4", "succeeded"),
    ]);
    expect(parked.get("run-a")).toEqual(["wu-1", "wu-2"]);
    expect(parked.get("run-b")).toEqual(["wu-3"]);
  });

  it("resolves out-of-order sequence numbers by seq, not by position", () => {
    // Journal reads are ascending today. Depending on that silently would make
    // this driver wrong the day anything batches or replays entries.
    const parked = latestParkedByRun([
      t(9, "run-a", "wu-1", "succeeded"),
      t(2, "run-a", "wu-1", "parked:rate_limit"),
    ]);
    expect(parked.size).toBe(0);
  });

  /** Never trust file content — this repo's own boundary rule. */
  it("skips an entry missing runId or workUnitId without dropping the rest", () => {
    const parked = latestParkedByRun([
      t(1, undefined, "wu-0", "parked:rate_limit"),
      t(2, "run-a", undefined, "parked:rate_limit"),
      t(3, "run-a", "wu-1", "parked:rate_limit"),
    ]);
    expect([...parked.entries()]).toEqual([["run-a", ["wu-1"]]]);
  });
});

describe("runsReadyToResume", () => {
  const parked = new Map([
    ["run-a", ["wu-1", "wu-2"]],
    ["run-b", ["wu-3"]],
  ]);

  it("returns a run once ANY of its parked units is past its reset", () => {
    const ready = runsReadyToResume(parked, (_run, wu) => wu === "wu-2");
    expect(ready).toEqual(["run-a"]);
  });

  /**
   * The restraint that matters. Resuming before the window passes spends an
   * engine call to be told the same thing again, and re-parks with a fresh
   * timer — a driver that did this on a tick would busy-loop against the
   * account's rate limiter.
   */
  it("returns NOTHING while every parked unit is still inside its window", () => {
    expect(runsReadyToResume(parked, () => false)).toEqual([]);
  });

  it("returns each ready run exactly once", () => {
    expect(runsReadyToResume(parked, () => true)).toEqual(["run-a", "run-b"]);
  });
});

describe("createParkResumeDriver", () => {
  const readyJournal = (): AttemptTransition[] => [t(1, "run-a", "wu-1", "parked:rate_limit")];

  it("resumes a run whose reset has passed", async () => {
    const resume = vi.fn().mockResolvedValue({ accepted: true });
    const driver = createParkResumeDriver({
      readTransitions: () => Promise.resolve(readyJournal()),
      isReadyToResume: () => Promise.resolve(true),
      resume,
    });
    await driver.tick();
    expect(resume).toHaveBeenCalledExactlyOnceWith("run-a");
  });

  it("resumes nothing while the window is still open", async () => {
    const resume = vi.fn();
    const driver = createParkResumeDriver({
      readTransitions: () => Promise.resolve(readyJournal()),
      isReadyToResume: () => Promise.resolve(false),
      resume,
    });
    await driver.tick();
    expect(resume).not.toHaveBeenCalled();
  });

  /**
   * A global pause is an account-wide signal. Resuming one run during it would
   * spend the very quota the pause exists to wait out.
   */
  it("resumes nothing while an account-wide pause is active", async () => {
    const resume = vi.fn();
    const driver = createParkResumeDriver({
      readTransitions: () => Promise.resolve(readyJournal()),
      isReadyToResume: () => Promise.resolve(true),
      isGloballyPaused: () => Promise.resolve(true),
      resume,
    });
    await driver.tick();
    expect(resume).not.toHaveBeenCalled();
  });

  /** A tick that throws must not kill the driver — the next window still matters. */
  it("survives a resume that throws, and reports it", async () => {
    const onError = vi.fn();
    const driver = createParkResumeDriver({
      readTransitions: () => Promise.resolve(readyJournal()),
      isReadyToResume: () => Promise.resolve(true),
      resume: () => Promise.reject(new Error("daemon busy")),
      onError,
    });
    await expect(driver.tick()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("survives a journal read that throws", async () => {
    const onError = vi.fn();
    const driver = createParkResumeDriver({
      readTransitions: () => Promise.reject(new Error("journal unreadable")),
      isReadyToResume: () => Promise.resolve(true),
      resume: vi.fn(),
      onError,
    });
    await expect(driver.tick()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });

  /**
   * Ticks must not overlap. A slow resume with a fast interval would otherwise
   * stack calls for the same run — the duplicate-dispatch this driver exists to
   * avoid, arriving through its own timer.
   */
  it("does not start a tick while one is still running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inResume = new Promise<void>((resolve) => (entered = resolve));
    const resume = vi.fn().mockImplementation(async () => {
      entered();
      await gate;
      return { accepted: true };
    });
    const driver = createParkResumeDriver({
      readTransitions: () => Promise.resolve(readyJournal()),
      isReadyToResume: () => Promise.resolve(true),
      resume,
    });
    const first = driver.tick();
    // Wait until the first tick is genuinely INSIDE `resume`, so the second
    // call below is a real overlap rather than a race this test happened to
    // win. Asserting before this point would pass whether or not the guard
    // exists — the vacuity this repository keeps paying for.
    await inResume;
    await driver.tick(); // must return immediately, doing nothing
    expect(resume).toHaveBeenCalledOnce();
    release();
    await first;
  });

  it("stop() is safe before start() and idempotent", () => {
    const driver = createParkResumeDriver({
      readTransitions: () => Promise.resolve([]),
      isReadyToResume: () => Promise.resolve(false),
      resume: vi.fn(),
    });
    expect(() => {
      driver.stop();
      driver.stop();
    }).not.toThrow();
  });
});

/**
 * THE WIRING. A driver nothing starts is the "handler with no reader" this
 * repository refuses everywhere else, so these tests are about the composition
 * root rather than the algorithm.
 */
describe("startParkResumeDriver", () => {
  const journalWith = (entries: readonly unknown[]): { journal: JournalStore } =>
    ({
      journal: {
        queryEntries: async function* () {
          for (const entry of entries) yield entry;
        },
      },
    }) as unknown as { journal: JournalStore };

  const parkEntry = {
    seq: 1,
    runId: "run-a",
    workUnitId: "wu-1",
    type: "work_unit_transition",
    payload: { status: "parked:rate_limit" },
  };

  /**
   * FIRST, because the daemon uses the return value AS its dispatcher. A
   * wrapper that returned the driver, or undefined, would disable dispatch
   * entirely while every other test here still passed.
   */
  it("returns the very same dispatcher it was handed", () => {
    const dispatcher = { resume: vi.fn() };
    expect(startParkResumeDriver(journalWith([]), dispatcher, { nowSeconds: () => 0 })).toBe(
      dispatcher,
    );
  });

  /**
   * `start()` arms a timer; it does not sweep. Booting the daemon must not
   * itself resume anything — recovery on boot is a different decision, with
   * different failure modes, and it is not this driver's to make.
   */
  it("does not sweep merely because the daemon booted", async () => {
    const dispatcher = { resume: vi.fn().mockResolvedValue({ accepted: true }) };
    startParkResumeDriver(journalWith([parkEntry]), dispatcher, {
      nowSeconds: () => 100,
      getParkStatus: () => Promise.resolve({ parked: true, readyToResume: true }),
      isGloballyPaused: () => Promise.resolve(false),
    } as never);
    await new Promise((r) => setImmediate(r));
    expect(dispatcher.resume).not.toHaveBeenCalled();
  });

  it("asks getParkStatus RUN-SCOPED, so another run's park cannot resume this one", async () => {
    const seen: unknown[] = [];
    const dispatcher = { resume: vi.fn().mockResolvedValue({ accepted: true }) };
    startParkResumeDriver(journalWith([parkEntry]), dispatcher, {
      nowSeconds: () => 100,
      intervalMs: 1,
      getParkStatus: (_j: unknown, workUnitId: unknown, now: unknown, runId: unknown) => {
        seen.push({ workUnitId, now, runId });
        return Promise.resolve({ parked: true, readyToResume: true });
      },
      isGloballyPaused: () => Promise.resolve(false),
    } as never);
    await vi.waitFor(() => expect(dispatcher.resume).toHaveBeenCalledWith("run-a"));
    expect(seen[0]).toEqual({ workUnitId: "wu-1", now: 100, runId: "run-a" });
  });
});
