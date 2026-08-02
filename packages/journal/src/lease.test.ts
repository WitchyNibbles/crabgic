import { spawn } from "node:child_process";
import { mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Lease, LeaseAcquireRaceLostError, LeaseHeldError, LeaseLostError } from "./lease.js";
import { prepareFixtureRuntime, type FixtureRuntime } from "./lease-fixtures/prepare-runtime.js";
import { readProcessStartTimeFromProc } from "./lease-proc-stat.js";

describe("Lease.acquire / release — unit (real filesystem, injected clock + process-start-time reader)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eo-lease-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a lease file with PID + start-time + expiry metadata, and release() removes it", async () => {
    const lease = await Lease.acquire(dir, "proj-basic", {
      pid: 999,
      clock: { now: () => 5_000 },
      readProcessStartTime: async () => 42,
      autoRenew: false,
      ttlMs: 10_000,
    });

    expect(lease.held).toBe(true);
    const raw = await readFile(lease.leasePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["pid"]).toBe(999);
    expect(parsed["startTimeTicks"]).toBe(42);
    expect(parsed["expiresAtMs"]).toBe(15_000);

    await lease.release();
    expect(lease.held).toBe(false);
    await expect(readFile(lease.leasePath, "utf8")).rejects.toThrow();
  });

  it("release() is idempotent (calling it twice does not throw)", async () => {
    const lease = await Lease.acquire(dir, "proj-idempotent-release", {
      pid: 1,
      clock: { now: () => 0 },
      readProcessStartTime: async () => 1,
      autoRenew: false,
    });
    await lease.release();
    await expect(lease.release()).resolves.toBeUndefined();
  });

  it("a second acquire is DENIED (LeaseHeldError) while the first holder is live and not expired", async () => {
    const clock = { now: () => 1_000_000 };
    const readProcessStartTime = async (): Promise<number> => 555;

    await Lease.acquire(dir, "proj-live", {
      pid: 111,
      clock,
      readProcessStartTime,
      autoRenew: false,
      ttlMs: 60_000,
    });

    await expect(
      Lease.acquire(dir, "proj-live", {
        pid: 222,
        clock,
        readProcessStartTime,
        autoRenew: false,
      }),
    ).rejects.toThrow(LeaseHeldError);
  });

  it("NEVER takes over while the recorded process is confirmed still alive, even after the clock says expired (roadmap/04 exit criterion)", async () => {
    let now = 1_000_000;
    const clock = { now: () => now };
    const readProcessStartTime = async (): Promise<number> => 777; // always reports "still alive, matching start time"

    await Lease.acquire(dir, "proj-alive-expired", {
      pid: 111,
      clock,
      readProcessStartTime,
      autoRenew: false,
      ttlMs: 1_000,
    });

    now += 50_000; // far past expiry by the clock alone

    await expect(
      Lease.acquire(dir, "proj-alive-expired", {
        pid: 222,
        clock,
        readProcessStartTime,
        autoRenew: false,
      }),
    ).rejects.toThrow(LeaseHeldError);
  });

  it("takes over once expired AND the recorded pid is confirmed dead (readProcessStartTime returns undefined)", async () => {
    let now = 1_000_000;
    const clock = { now: () => now };
    const readProcessStartTime = async (): Promise<undefined> => undefined; // recorded pid no longer exists

    await Lease.acquire(dir, "proj-dead-takeover", {
      pid: 111,
      clock,
      readProcessStartTime,
      autoRenew: false,
      ttlMs: 1_000,
    });

    now += 50_000;

    const second = await Lease.acquire(dir, "proj-dead-takeover", {
      pid: 222,
      clock,
      readProcessStartTime,
      autoRenew: false,
      ttlMs: 1_000,
    });
    expect(second.pid).toBe(222);
    expect(second.held).toBe(true);
  });

  it("takes over when the lease file is corrupt (unparseable — nothing to protect)", async () => {
    const leasePath = join(dir, "proj-corrupt.lease.json");
    await writeFile(leasePath, "{ this is not valid json", "utf8");

    const lease = await Lease.acquire(dir, "proj-corrupt", {
      pid: 333,
      clock: { now: () => 0 },
      readProcessStartTime: async () => 1,
      autoRenew: false,
    });
    expect(lease.pid).toBe(333);

    const raw = await readFile(leasePath, "utf8");
    expect(() => JSON.parse(raw) as unknown).not.toThrow();
  });

  it("retries across maxAcquireAttempts until eligibility is reached (genuinely exercises the retry delay)", async () => {
    let now = 1_000_000;
    const clock = { now: () => now };
    // Keyed on pid 111 (the original holder) specifically, so pid 222's own
    // "what's my start time" self-lookup (a different pid) never perturbs
    // this counter. First TWO reads of pid 111 report "alive" (42) — one
    // for pid 111's own acquire, one for the second acquire's first
    // contended check (denied, forcing a real retry); the third read
    // reports "dead" (undefined), letting the retry succeed.
    let calls111 = 0;
    const readProcessStartTime = async (pid: number): Promise<number | undefined> => {
      if (pid !== 111) return 999;
      calls111 += 1;
      return calls111 <= 2 ? 42 : undefined;
    };

    await Lease.acquire(dir, "proj-retry", {
      pid: 111,
      clock,
      readProcessStartTime,
      autoRenew: false,
      ttlMs: 1_000,
    });
    now += 5_000; // expired by clock; first contended check still reports "alive" -> denied -> real retry

    const second = await Lease.acquire(dir, "proj-retry", {
      pid: 222,
      clock,
      readProcessStartTime,
      autoRenew: false,
      ttlMs: 1_000,
      maxAcquireAttempts: 3,
      retryDelayMs: 5,
    });
    expect(second.pid).toBe(222);
    expect(calls111).toBe(3);
  });

  it("propagates a non-EEXIST error from the underlying atomic create instead of treating it as contention", async () => {
    const { chmod } = await import("node:fs/promises");
    // A read-only lease directory: open(path, "wx") fails EACCES on the
    // CREATE attempt itself (the file never existed) — tryAcquireOnce must
    // rethrow this as-is, never entering the EEXIST-only contended path.
    await chmod(dir, 0o500);
    try {
      await expect(
        Lease.acquire(dir, "proj-eacces", {
          pid: 1,
          clock: { now: () => 0 },
          readProcessStartTime: async () => 1,
          autoRenew: false,
        }),
      ).rejects.toHaveProperty("code", "EACCES");
    } finally {
      await chmod(dir, 0o700);
    }
  });

  it("release() on a lease file that has already vanished entirely is a no-op, not an error", async () => {
    const { unlink } = await import("node:fs/promises");
    const lease = await Lease.acquire(dir, "proj-vanished", {
      pid: 1,
      clock: { now: () => 0 },
      readProcessStartTime: async () => 1,
      autoRenew: false,
    });
    await unlink(lease.leasePath);

    await expect(lease.release()).resolves.toBeUndefined();
    expect(lease.held).toBe(false);
  });

  it("the automatic heartbeat interval actually renews the on-disk record (autoRenew: true)", async () => {
    const lease = await Lease.acquire(dir, "proj-heartbeat", {
      pid: 1,
      readProcessStartTime: async () => 1,
      heartbeatIntervalMs: 15,
      ttlMs: 200,
      autoRenew: true,
    });
    const before = lease.record.renewedAtMs;
    // Polls for the OBSERVED renewal; the old fixed 120ms sleep raced the 15ms interval.
    const renewed = (): void => expect(lease.record.renewedAtMs).toBeGreaterThan(before);
    await vi.waitFor(renewed, { timeout: 15_000, interval: 5 });
    await lease.release();
    renewed();
  });

  it("renewNow() advances renewedAtMs/expiresAtMs on disk without changing pid/startTimeTicks", async () => {
    let now = 1_000_000;
    const clock = { now: () => now };
    const lease = await Lease.acquire(dir, "proj-renew", {
      pid: 111,
      clock,
      readProcessStartTime: async () => 42,
      autoRenew: false,
      ttlMs: 1_000,
    });
    const before = lease.record;

    now += 500;
    await lease.renewNow();

    expect(lease.record.pid).toBe(before.pid);
    expect(lease.record.startTimeTicks).toBe(before.startTimeTicks);
    expect(lease.record.renewedAtMs).toBe(1_000_500);
    expect(lease.record.expiresAtMs).toBe(1_001_500);

    const raw = await readFile(lease.leasePath, "utf8");
    const onDisk = JSON.parse(raw) as Record<string, unknown>;
    expect(onDisk["renewedAtMs"]).toBe(1_000_500);
  });

  it("release() does NOT delete a lease file that a takeover already replaced (never destroys a live new holder's lease)", async () => {
    const lease = await Lease.acquire(dir, "proj-stale-release", {
      pid: 111,
      clock: { now: () => 0 },
      readProcessStartTime: async () => 1,
      autoRenew: false,
    });

    // Simulate: this holder's TTL lapsed and a different process legitimately took over.
    const otherHoldersRecord = {
      schemaVersion: 1,
      projectHash: "proj-stale-release",
      pid: 222,
      startTimeTicks: 2,
      heartbeatIntervalMs: 5_000,
      acquiredAtMs: 999,
      renewedAtMs: 999,
      expiresAtMs: 999_999,
    };
    await writeFile(lease.leasePath, JSON.stringify(otherHoldersRecord), "utf8");

    await lease.release();

    const raw = await readFile(lease.leasePath, "utf8");
    expect(JSON.parse(raw) as unknown).toEqual(otherHoldersRecord);
  });
});

describe("LeaseAcquireRaceLostError — unit", () => {
  it("carries the lease path and a descriptive message (the residual-takeover-race error documented in lease.ts)", () => {
    const err = new LeaseAcquireRaceLostError("/tmp/x/proj.lease.json");
    expect(err.name).toBe("LeaseAcquireRaceLostError");
    expect(err.leasePath).toBe("/tmp/x/proj.lease.json");
    expect(err.message).toContain("/tmp/x/proj.lease.json");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("Lease.acquire — INTEGRATION: two real child processes contending for one lease dir (roadmap/04 work item 6 exit criterion)", () => {
  let dir: string;
  let runtime: FixtureRuntime;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eo-lease-integration-"));
    runtime = await prepareFixtureRuntime("lease-acquire-attempt.ts");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await runtime.cleanup();
  });

  /**
   * A spawned contender that ANNOUNCES its outcome and then waits.
   *
   * `announced` resolves as soon as the child has printed its decision;
   * `release()` closes its stdin so it can finish. Splitting those two is what
   * lets the test hold BOTH children alive until both have decided.
   */
  interface Contender {
    readonly announced: Promise<string>;
    release(): void;
    readonly finished: Promise<void>;
  }

  function spawnAttempt(): Contender {
    const child = spawn(
      process.execPath,
      // NO pid argument: each child uses its OWN, real `process.pid` — see the
      // block comment on the test below for why a synthetic pid silently
      // disabled the guarantee this test exists to certify.
      [runtime.entryPath, dir, "proj-real-contention"],
      // stdin is a PIPE now, not `ignore`: closing it is the release signal.
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const announced = new Promise<string>((resolve, reject) => {
      child.stdout.on("data", () => {
        if (stdout.includes("\n")) resolve(stdout);
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (stdout.includes("\n")) return; // already announced; the exit is the release
        reject(
          new Error(`fixture child exited ${String(code)} before announcing, stderr: ${stderr}`),
        );
      });
    });

    const finished = new Promise<void>((resolve, reject) => {
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`fixture child exited ${String(code)}, stderr: ${stderr}`));
      });
    });

    return {
      announced,
      finished,
      release: () => {
        child.stdin.end();
      },
    };
  }

  /**
   * THE EXIT-CRITERION TEST, and it now enforces the race it measures.
   *
   * It used to spawn two children that each held for a fixed 300ms and exited.
   * On a loaded machine the second child's cold Node start could land entirely
   * after the first had released, so both legitimately acquired and the test
   * went red with `["ACQUIRED", "ACQUIRED"]` — which means "no contention
   * happened", not "mutual exclusion failed". It was carried as a known flake
   * for weeks, and a test that reports a red for the absence of a race cannot
   * certify the presence of mutual exclusion.
   *
   * Both children now hold their decision until this test releases them, so the
   * overlap is a fact: neither is allowed to finish until both have decided.
   *
   * THE SECOND CAUSE (2026-08-01) — the hold above was necessary and not
   * sufficient, and this kept flaking in CI with the same `["ACQUIRED",
   * "ACQUIRED"]`. The children used to be given SYNTHETIC pids (1000001,
   * 1000002). No such process exists, so `readProcessStartTime` found nothing,
   * `recordedProcessStillAlive` was permanently false, and `isTakeoverEligible`
   * fell through to `isLeaseExpired` — meaning the mutual exclusion this test
   * certifies rested entirely on the contender reaching its check within the
   * 15s TTL. On a loaded runner two cold Node starts can miss that window, and
   * the second child then legitimately TOOK OVER what it was entitled to read
   * as a dead holder's lease. The double acquire was correct behaviour being
   * asked the wrong question.
   *
   * Each child now uses its OWN, real `process.pid`. The holder is genuinely
   * alive and `/proc` says so with a matching start time, so the contender is
   * refused by the liveness guarantee itself rather than by a timeout — which
   * is the production guarantee this exit criterion is supposed to prove, and
   * it is now timing-independent. (Linux/WSL2: start-time verification is
   * documented as Linux-only, and off-`/proc` platforms degrade to the TTL
   * path, as `Lease.acquire`'s own fallback comment records.)
   *
   * THE THIRD CAUSE (2026-08-01) — and this one was a genuine production
   * mutual-exclusion defect, not a test that was asking the wrong question.
   * Publishing a fresh lease was `open(path, "wx")` followed by a SEPARATE
   * write, so between those two syscalls the lease path existed and was
   * EMPTY. The contender's create failed EEXIST, its read returned `""`,
   * `parseLeaseRecord("")` returned `undefined`, and
   * `isTakeoverEligible(undefined, ...)` returns `true` UNCONDITIONALLY —
   * without ever consulting pid liveness, so the real-pid fix above was
   * bypassed entirely. The contender renamed its record over the holder's and
   * both returned ACQUIRED. Measured at 9 double acquires in 11,000
   * two-process races on an idle machine; two near-simultaneous
   * `bootSupervisor` calls are an expected production event, and the journal's
   * `appendEntry` takes no lock of its own, so the lease is the only
   * single-writer guarantee there is. `tryAcquireOnce` now stages the complete
   * record under a private name and `link()`s it into place, so the lease path
   * is never observable without its full payload.
   *
   * WHY THIS TEST KEPT BEING THE ONLY ONE TO CATCH IT, and what changed. The
   * window never opens for two IN-PROCESS acquirers (one event loop queues the
   * winner's write continuation ahead of the loser's read), so only two real
   * OS processes could ever hit it — as a probability, which is a flake, not a
   * pin. This test stays exactly as it is: it is the exit criterion and the
   * only end-to-end proof. But all three causes now also have deterministic
   * unit-level pins that name them, in `lease-acquire.test.ts`.
   */
  it("exactly one of two real, concurrently-spawned child processes acquires the lease", async () => {
    const a = spawnAttempt();
    const b = spawnAttempt();

    // Both have DECIDED, and neither has released — this is the contended
    // window, and it is now guaranteed rather than hoped for.
    const [outputA, outputB] = await Promise.all([a.announced, b.announced]);

    const outcomes = [outputA, outputB].map((output) => output.trim().split(":")[1]);
    expect(outcomes.sort()).toEqual(["ACQUIRED", "DENIED"]);

    // REGRESSION PIN for the second cause. The denial above is only
    // timing-independent while the holder's recorded pid is a genuinely LIVE
    // process — that is what makes `recordedProcessStillAlive` true and stops
    // `isTakeoverEligible` falling through to the 15s TTL. If a future edit
    // reintroduces a synthetic pid, the assertion above keeps passing on an
    // idle machine and silently rots back into a race; this one does not.
    const holderPid = (
      JSON.parse(await readFile(join(dir, "proj-real-contention.lease.json"), "utf8")) as {
        readonly pid: number;
      }
    ).pid;
    expect(await readProcessStartTimeFromProc(holderPid)).toBeDefined();

    a.release();
    b.release();
    await Promise.all([a.finished, b.finished]);
  }, 20_000);
});

describe("VALIDATION ROUND (2026-07-18) — MAJOR 2 regression: out-of-band lease-file removal must never create a silent double holder", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eo-lease-double-holder-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * The adversarial validator's exact repro (phase-04 validation round,
   * MAJOR 2): holder A acquires; the lease file is removed OUT-OF-BAND
   * (not via A's own `release()` — e.g. an operator or a misbehaving
   * cleanup script); B legitimately acquires via the fast O_EXCL path
   * (the file is genuinely absent, so nothing here is a bug in
   * `tryAcquireOnce`); A is still `held === true` and, on unfixed code,
   * `#renew()`'s temp+rename-replace has NO ownership guard (asymmetric
   * with `#release()`'s own `stillOurs` check) — so A's next renewal
   * silently CLOBBERS B's legitimate lease file, producing a silent
   * single-supervisor-invariant violation (two holders both believe
   * `held === true`).
   *
   * Written first against UNFIXED `lease.ts` — see
   * docs/evidence/phase-04/fix2-lease-double-holder-failing.txt for the
   * captured RED run (this exact assertion body, before `#renew` gained
   * an ownership-revalidation guard). After the fix this test is expected
   * to look the same in substance but the final assertions were
   * strengthened to also check the typed `LeaseLostError` — see
   * docs/evidence/phase-04/fix2-lease-double-holder-passing.txt.
   */
  it("A's renewNow() must NEVER clobber B's file once B has legitimately acquired after an out-of-band deletion", async () => {
    const clock = { now: () => 1_000_000 };
    const leaseA = await Lease.acquire(dir, "proj-double-holder", {
      pid: 111,
      clock,
      readProcessStartTime: async () => 42,
      autoRenew: false,
      ttlMs: 60_000,
    });
    expect(leaseA.held).toBe(true);

    // Out-of-band removal — NOT `leaseA.release()`.
    await unlink(leaseA.leasePath);

    // B legitimately acquires: the file is genuinely absent, so the fast
    // O_EXCL create path succeeds on its own merits.
    const leaseB = await Lease.acquire(dir, "proj-double-holder", {
      pid: 222,
      clock,
      readProcessStartTime: async () => 99,
      autoRenew: false,
      ttlMs: 60_000,
    });
    expect(leaseB.held).toBe(true);
    const bRecordBefore = await readFile(leaseB.leasePath, "utf8");

    // THE FIX'S CORE ASSERTION: A's renewal must detect it no longer owns
    // the on-disk file and must refuse to write — never clobber B.
    await expect(leaseA.renewNow()).rejects.toMatchObject({
      name: "LeaseLostError",
      reason: "ownership_mismatch",
    });
    expect(leaseA.held).toBe(false);
    expect(leaseA.lostReason).toBe("ownership_mismatch");
    expect(leaseA.lastHeartbeatError).toBeInstanceOf(LeaseLostError);

    const bRecordAfter = await readFile(leaseB.leasePath, "utf8");
    expect(bRecordAfter).toBe(bRecordBefore); // byte-identical — B's file was NEVER touched by A.

    // Exactly one holder survives.
    expect(leaseA.held).toBe(false);
    expect(leaseB.held).toBe(true);
  });

  it("out-of-band deletion (file simply gone, no replacement yet): renewNow() rejects LeaseLostError('missing') and writes nothing", async () => {
    const clock = { now: () => 1_000_000 };
    const leaseA = await Lease.acquire(dir, "proj-missing-only", {
      pid: 111,
      clock,
      readProcessStartTime: async () => 42,
      autoRenew: false,
      ttlMs: 60_000,
    });
    await unlink(leaseA.leasePath);

    await expect(leaseA.renewNow()).rejects.toMatchObject({
      name: "LeaseLostError",
      reason: "missing",
    });
    expect(leaseA.held).toBe(false);
    await expect(readFile(leaseA.leasePath, "utf8")).rejects.toThrow(); // still absent — A never recreated it
  });

  /**
   * DETERMINISM NOTE (2026-08-02). This test used to `unlink` A's lease file
   * and only THEN `await Lease.acquire` for B, which left a real interval —
   * on this filesystem usually wider than A's 10ms heartbeat — during which
   * the path was legitimately ABSENT. A heartbeat landing in that window
   * reads no record and correctly reports `missing`, so the test's own
   * choreography, not the code under test, decided which reason it saw. It
   * failed 10 of 20 runs here (and, per phase-04's closeout note, 5/5 when
   * run alone), while passing on GitHub runners whose gap is narrower.
   *
   * B's record is therefore acquired FIRST, in a sub-directory, and swapped
   * in under A with a single `rename` — an atomic replace, so the path holds
   * A's record and then B's with no observable state in between. `missing`
   * becomes unreachable and `ownership_mismatch` is the only reason the
   * heartbeat can report. Nothing in `lease.ts` changes; the fixed window
   * was only ever in the test.
   */
  it("onLeaseLost fires exactly once, synchronously, when the automatic heartbeat detects loss", async () => {
    const clock = { now: () => 1_000_000 };
    const lostEvents: string[] = [];
    const heldInsideCallback: boolean[] = [];

    const leaseB = await Lease.acquire(join(dir, "b-source"), "proj-heartbeat-loss", {
      pid: 222,
      clock,
      readProcessStartTime: async () => 99,
      autoRenew: false,
      ttlMs: 60_000,
    });

    const leaseA = await Lease.acquire(dir, "proj-heartbeat-loss", {
      pid: 111,
      clock,
      readProcessStartTime: async () => 42,
      autoRenew: true,
      heartbeatIntervalMs: 10,
      ttlMs: 60_000,
      onLeaseLost: (err) => {
        lostEvents.push(err.reason);
        heldInsideCallback.push(leaseA.held);
      },
    });

    // Deliberately NO `await` between the acquire above and this `rename`: the
    // swap is issued from the microtask that follows A's acquire, i.e. strictly
    // before A's first 10ms timer callback can run, and it is queued on libuv's
    // FIFO threadpool ahead of any read that callback later makes. A's
    // heartbeat can only ever observe B's record.
    await rename(leaseB.leasePath, leaseA.leasePath);

    // Waits for the heartbeat to be OBSERVED rather than sleeping a fixed 60ms
    // and hoping a tick landed inside it.
    await vi.waitFor(() => expect(lostEvents.length).toBe(1), { timeout: 15_000, interval: 5 });
    // Several further heartbeat intervals: a second event here would mean
    // `#markLost` failed to clear the timer. This cannot flake in the failing
    // direction — once the interval is cleared, no later event can arrive.
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(leaseA.held).toBe(false);
    expect(lostEvents).toEqual(["ownership_mismatch"]);
    // Synchronous, as the name claims: the callback already saw `held === false`,
    // so it ran from inside `#markLost` after the transition was committed.
    expect(heldInsideCallback).toEqual([false]);
  });
});
