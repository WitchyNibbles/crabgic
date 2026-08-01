import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LeaseAcquireRaceLostError } from "./lease-errors.js";
import { publishExclusive, tryAcquireOnce, type TryAcquireResult } from "./lease-acquire.js";
import { buildLeaseRecord, parseLeaseRecord, type LeaseRecord } from "./lease-record.js";

/**
 * DETERMINISTIC PINS for `tryAcquireOnce`'s publish window.
 *
 * `lease.test.ts`'s two-real-child-process integration test is the
 * exit-criterion proof that mutual exclusion holds end to end, but it can
 * only assert the OUTCOME of an interleaving it hopes for. Three distinct
 * causes have now hidden behind that one intermittent red. These tests use
 * the `TryAcquireHooks` seam to place a second acquirer at an exact point
 * inside the first acquirer's critical section, so each cause gets a pin
 * that names it and fails 100% of the time when reintroduced.
 */

const TTL_MS = 60_000;
const HEARTBEAT_MS = 5_000;
const NOW_MS = 1_000_000;

const CLOCK = { now: (): number => NOW_MS };

/** Every recorded pid reports the same start time, so every parseable holder reads as genuinely LIVE — denial must come from the liveness guarantee, never from a TTL lapse. */
const ALL_ALIVE = async (): Promise<number> => 42;

function recordFor(projectHash: string, pid: number): LeaseRecord {
  return buildLeaseRecord({
    projectHash,
    pid,
    startTimeTicks: 42,
    nowMs: NOW_MS,
    ttlMs: TTL_MS,
    heartbeatIntervalMs: HEARTBEAT_MS,
  });
}

/**
 * A one-shot rendezvous: `hook` (installed as a `TryAcquireHooks` member)
 * resolves `entered` when the acquirer reaches that point, then blocks there
 * until the test calls `release()`.
 */
function makeGate(): {
  readonly entered: Promise<void>;
  readonly hook: () => Promise<void>;
  release(): void;
} {
  let signalEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    signalEntered = resolve;
  });
  let signalReleased!: () => void;
  const released = new Promise<void>((resolve) => {
    signalReleased = resolve;
  });
  return {
    entered,
    hook: async () => {
      signalEntered();
      await released;
    },
    release: () => {
      signalReleased();
    },
  };
}

describe("tryAcquireOnce — publish-window mutual exclusion", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eo-lease-acquire-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * THE THIRD CAUSE of `lease.test.ts`'s intermittent double acquire.
   *
   * The publish of a fresh lease used to be two syscalls — `open(path,
   * "wx")` then a separate `writeFile` — so between them the lease path
   * EXISTED and was EMPTY. A contender's own `open(path, "wx")` failed
   * EEXIST, its read returned `""`, `parseLeaseRecord("")` returned
   * `undefined`, and `isTakeoverEligible(undefined, ...)` returns `true`
   * UNCONDITIONALLY — never consulting pid liveness, so the real-pid fix
   * that closed the second cause was bypassed entirely. The contender then
   * renamed its own record over the holder's path and both returned
   * `acquired`. Measured at 9 double acquires in 11,000 two-process races on
   * an idle machine; the window never opens for two in-process acquirers
   * racing via `Promise.all` (one event loop queues the winner's write
   * continuation ahead of the loser's read), which is why only the
   * real-child-process test ever went red and why this cause hid behind the
   * other two.
   *
   * The assertion encodes no winner: whoever publishes first owns the file,
   * and the other must be denied. That is the whole guarantee.
   */
  it("an acquirer paused between staking its claim and publishing its record never shares the lease with a concurrent complete acquirer", async () => {
    const leasePath = join(dir, "proj-publish-window.lease.json");
    const recordA = recordFor("proj-publish-window", 111);
    const recordB = recordFor("proj-publish-window", 222);

    const gate = makeGate();
    const pendingA = tryAcquireOnce(leasePath, recordA, CLOCK, ALL_ALIVE, {
      beforePublish: gate.hook,
    });
    await gate.entered;

    // B runs a COMPLETE attempt while A is parked inside its publish.
    const b = await tryAcquireOnce(leasePath, recordB, CLOCK, ALL_ALIVE);

    gate.release();
    const a = await pendingA;

    expect([a.status, b.status].sort()).toEqual(["acquired", "denied"]);

    const onDisk = parseLeaseRecord(await readFile(leasePath, "utf8"));
    const winner = a.status === "acquired" ? recordA : recordB;
    expect(onDisk).toEqual(winner);
  });

  /**
   * The EEXIST-then-ENOENT route (W3), distinct from the empty-file window
   * above and from the documented takeover residual.
   *
   * A contender loses the exclusive create, and only THEN does the holder
   * release. Its contended read finds nothing, `isTakeoverEligible(undefined,
   * ...)` grants a takeover, and the takeover publishes by `rename()` — which
   * cannot lose. Any third process that legitimately created the lease in the
   * interval between that read and that rename is silently clobbered, and
   * both believe they hold it.
   *
   * The assertion is fix-agnostic: whoever claims `acquired` must be the sole
   * owner of the on-disk record, and there must be exactly one of them.
   */
  it("an acquirer whose contended read finds the holder gone must never clobber a third process's fresh lease", async () => {
    const leasePath = join(dir, "proj-vanished-holder.lease.json");
    const holder = recordFor("proj-vanished-holder", 111);
    await writeFile(leasePath, JSON.stringify(holder), "utf8");

    const recordB = recordFor("proj-vanished-holder", 222);
    const recordC = recordFor("proj-vanished-holder", 333);

    let holderReleased = false;
    let resultC: TryAcquireResult | undefined;

    const b = await tryAcquireOnce(leasePath, recordB, CLOCK, ALL_ALIVE, {
      // The holder releases exactly once — after B's create already lost.
      beforeContendedRead: async () => {
        if (holderReleased) return;
        holderReleased = true;
        await unlink(leasePath);
      },
      // A third process acquires cleanly while B is mid-takeover.
      beforeTakeoverWrite: async () => {
        resultC = await tryAcquireOnce(leasePath, recordC, CLOCK, ALL_ALIVE);
      },
    });

    const parties = [
      { result: b, record: recordB },
      ...(resultC === undefined ? [] : [{ result: resultC, record: recordC }]),
    ];
    const acquired = parties.filter((party) => party.result.status === "acquired");

    expect(acquired).toHaveLength(1);
    expect(parseLeaseRecord(await readFile(leasePath, "utf8"))).toEqual(acquired[0]?.record);
  });

  it("gives up with LeaseAcquireRaceLostError, claiming nothing, when the lease path flaps for every bounded pass", async () => {
    const leasePath = join(dir, "proj-flap.lease.json");
    let publishes = 0;
    let contendedReads = 0;

    const outcome = await tryAcquireOnce(leasePath, recordFor("proj-flap", 111), CLOCK, ALL_ALIVE, {
      // Someone else links the path just before we do -> our link loses.
      beforePublish: async () => {
        publishes += 1;
        await writeFile(leasePath, "someone-elses-lease", "utf8");
      },
      // ...and releases it again just before we can read it -> nothing to
      // defer to, so the attempt re-enters the create rather than taking over.
      beforeContendedRead: async () => {
        contendedReads += 1;
        await unlink(leasePath);
      },
    });

    expect(outcome.status).toBe("denied");
    expect(outcome.error).toBeInstanceOf(LeaseAcquireRaceLostError);
    expect(outcome.record).toBeUndefined();
    expect([publishes, contendedReads]).toEqual([3, 3]); // bounded, not unbounded
    await expect(readFile(leasePath, "utf8")).rejects.toHaveProperty("code", "ENOENT");
  });

  it("propagates a contended-read failure that is not ENOENT instead of reading it as 'no holder'", async () => {
    const leasePath = join(dir, "proj-unreadable.lease.json");

    // A directory at the lease path: `link` still fails EEXIST, but the
    // contended read fails EISDIR. That used to be swallowed by
    // `.catch(() => undefined)` and granted a takeover — an unreadable lease
    // fail-OPENING is the opposite of what this primitive is for.
    await expect(
      tryAcquireOnce(leasePath, recordFor("proj-unreadable", 111), CLOCK, ALL_ALIVE, {
        beforePublish: async () => {
          await mkdir(leasePath);
        },
      }),
    ).rejects.toHaveProperty("code", "EISDIR");
  });

  it("propagates a non-EEXIST publish failure instead of reporting it as contention", async () => {
    const leasePath = join(dir, "proj-link-eacces.lease.json");
    try {
      await expect(
        tryAcquireOnce(leasePath, recordFor("proj-link-eacces", 111), CLOCK, ALL_ALIVE, {
          // The directory becomes unwritable after the stage file exists, so
          // the link itself fails EACCES (and so does the stage cleanup,
          // which is best-effort by design).
          beforePublish: async () => {
            await chmod(dir, 0o500);
          },
        }),
      ).rejects.toHaveProperty("code", "EACCES");
    } finally {
      await chmod(dir, 0o700);
    }
  });
});

describe("publishExclusive — atomic content publish", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eo-lease-publish-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("links a complete 0600 payload into place and leaves no stage file behind", async () => {
    const path = join(dir, "target.json");
    const outcome = await publishExclusive(path, "the-whole-payload", `${path}.stage-1`);

    expect(outcome).toBe("published");
    expect(await readFile(path, "utf8")).toBe("the-whole-payload");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual([basename(path)]);
  });

  it("reports 'exists' without touching the existing file, and still cleans up its stage file", async () => {
    const path = join(dir, "target.json");
    await writeFile(path, "the-incumbent", "utf8");

    const outcome = await publishExclusive(path, "the-challenger", `${path}.stage-1`);

    expect(outcome).toBe("exists");
    expect(await readFile(path, "utf8")).toBe("the-incumbent");
    expect(await readdir(dir)).toEqual([basename(path)]);
  });
});
