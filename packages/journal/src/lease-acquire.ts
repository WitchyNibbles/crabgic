/**
 * `tryAcquireOnce` and its private helpers — split out of `lease.ts` to
 * keep that file under this repo's file-size convention (VALIDATION ROUND
 * 2026-07-18, MAJOR 2 fix added enough self-defense logic to `lease.ts`
 * that its acquisition-attempt path was extracted here, mirroring the
 * existing `lease-record.ts`/`lease-proc-stat.ts` split). `Lease.acquire`
 * (in `lease.ts`) is the only caller.
 */

import { link, open, readFile, rename, unlink } from "node:fs/promises";
import { LeaseAcquireRaceLostError, LeaseHeldError } from "./lease-errors.js";
import { isTakeoverEligible, parseLeaseRecord, type LeaseRecord } from "./lease-record.js";
import type { ProcessStartTimeReader } from "./lease-proc-stat.js";

export interface LeaseClock {
  readonly now: () => number;
}

/**
 * TEST-ONLY interleaving seam for `tryAcquireOnce`, in the same
 * dependency-injection style this module already uses for `clock` and
 * `readProcessStartTime`. Production call sites pass nothing; every hook is
 * optional and defaults to a no-op.
 *
 * It exists because the concurrency defects this path has shipped are all
 * "two processes both believe they won", and the only way to pin one of
 * those as a regression test is to place a second acquirer at an exact
 * point inside the first acquirer's critical section. Asserting on a hoped-for
 * interleaving instead is what let three distinct causes hide behind one
 * intermittent red in `lease.test.ts`'s two-child integration test.
 */
export interface TryAcquireHooks {
  /**
   * Awaited once this attempt has durable on-disk state for its claim but
   * before that claim becomes visible at the lease path.
   */
  readonly beforePublish?: () => Promise<void>;
  /**
   * Awaited after the exclusive create lost to an existing file, before the
   * contended read of that file.
   */
  readonly beforeContendedRead?: () => Promise<void>;
  /**
   * Awaited after takeover eligibility was granted, before the takeover
   * write + rename.
   */
  readonly beforeTakeoverWrite?: () => Promise<void>;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

/**
 * Atomically creates `path` (fails `EEXIST` if it already exists — see
 * `man 2 open`, `O_EXCL`) and writes+syncs `payload`.
 *
 * USE THIS ONLY FOR A PRIVATELY-NAMED FILE nobody else reads — the takeover
 * temp file below, and `lease.ts`'s renew temp file. It is NOT safe as the
 * publish step for the lease path itself: `open` and the write are two
 * syscalls, so between them the path exists and is EMPTY, and an empty file
 * reads as `undefined` from `parseLeaseRecord`, which
 * `isTakeoverEligible` grants a takeover for unconditionally. See
 * `publishExclusive`.
 *
 * An earlier, deliberately naive version of this function
 * (`writeFile(path, payload, "utf8")` — no O_EXCL, blind overwrite) was used
 * to capture the required failing-first evidence; see
 * docs/evidence/phase-04/wi6-lease-{failing,passing}.txt.
 */
export async function stageExclusive(path: string, payload: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * The outcome of a publish attempt. `"exists"` means the lease path was
 * already linked by someone else — the create-time equivalent of `O_EXCL`'s
 * `EEXIST`, reported as a value rather than an exception so that an
 * `EEXIST` on the private stage path (which is never contention) can still
 * propagate as the genuine error it is.
 */
export type PublishOutcome = "published" | "exists";

/**
 * Publishes `payload` at `path` atomically **with its content**: stage the
 * complete, fsynced record under `stagePath` first, then `link()` it into
 * place. `link(2)` fails `EEXIST` if the destination exists, exactly like an
 * `O_EXCL` create, so this keeps the single-winner property — but unlike an
 * `O_EXCL` create it publishes a name that already has its bytes. The lease
 * path is therefore never observable in a partially-written state, by
 * anyone, ever. (The classic POSIX lockfile idiom.)
 *
 * WHY (2026-08-01, the third cause of `lease.test.ts`'s intermittent double
 * acquire — see `packages/journal/src/lease-acquire.test.ts`): publishing
 * with `open(path, "wx")` + a separate write left the lease path existing
 * and EMPTY between the two syscalls. A contender's create failed `EEXIST`,
 * its read returned `""`, `parseLeaseRecord("")` returned `undefined`, and
 * `isTakeoverEligible(undefined, ...)` returns `true` UNCONDITIONALLY —
 * without ever consulting pid liveness, bypassing the real-pid guarantee
 * that closed the second cause. The contender renamed over the holder and
 * both returned `acquired`. Measured at 9 double acquires in 11,000
 * two-process races on an idle machine.
 *
 * The stage file is unlinked on every path. A crash between the stage and
 * the link leaves an inert `*.stage-*` file — nothing ever reads it
 * (`leaseFileName` is an exact match), the same accepted residue class as
 * the `*.tmp-*` takeover files.
 */
export async function publishExclusive(
  path: string,
  payload: string,
  stagePath: string,
  hooks?: TryAcquireHooks,
): Promise<PublishOutcome> {
  await stageExclusive(stagePath, payload);
  try {
    await hooks?.beforePublish?.();
    await link(stagePath, path);
    return "published";
  } catch (err) {
    if (isErrnoException(err) && err.code === "EEXIST") return "exists";
    throw err;
  } finally {
    await unlink(stagePath).catch(() => {
      // Best effort: see this function's residue note above.
    });
  }
}

/** A collision-resistant sibling of `path` for staging: `<path>.<kind>-<pid>-<now>-<rand>`. */
function uniqueSiblingPath(
  path: string,
  kind: "stage" | "tmp",
  pid: number,
  nowMs: number,
): string {
  return `${path}.${kind}-${pid}-${nowMs}-${Math.random().toString(36).slice(2)}`;
}

export async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export interface TryAcquireResult {
  readonly status: "acquired" | "denied";
  readonly record?: LeaseRecord;
  readonly error?: Error;
}

/**
 * How many times one attempt re-enters the exclusive create before giving
 * up. Each extra pass costs nothing unless the lease path is actively
 * flapping between "held" and "released", and three is enough that a
 * legitimate release-then-reacquire never surfaces as a spurious denial —
 * while still bounding a pathological flap. `Lease.acquire`'s own
 * `maxAcquireAttempts` retry sits above this.
 */
const MAX_PUBLISH_ATTEMPTS = 3;

/**
 * A single acquisition attempt. Fast path: stage the complete record under
 * a private name and `link()` it onto the lease path — `link(2)` fails
 * `EEXIST` if the destination exists, so when two processes race this call
 * for the same brand-new lease path exactly one link succeeds and the other
 * loses at the kernel level. That is the property the two-real-child-process
 * integration test in `lease.test.ts` exercises directly (roadmap/04's exit
 * criterion for this work item). It used to be an `O_EXCL` create followed
 * by a separate write; see `publishExclusive` for why publishing the name
 * before its bytes was itself a mutual-exclusion defect.
 *
 * Contended path (path already linked): read + parse the existing record,
 * ask the caller-injected `readProcessStartTime` whether its pid is still
 * running with the same start time, and defer to the pure
 * `isTakeoverEligible` decision. A takeover writes a fresh record to a
 * uniquely-named temp file, `rename()`s it over the lease path (POSIX
 * `rename` is an atomic replace), then reads the path back and confirms it
 * is the record THIS attempt just wrote.
 *
 * ABSENT IS NOT UNPARSEABLE, and the two must not share a branch:
 *   - The contended read finding NOTHING (`ENOENT`) means the holder
 *     released in the interval between our failed link and that read. This
 *     re-enters the exclusive create rather than taking the takeover path,
 *     because the takeover publishes by `rename()` and `rename()` CANNOT
 *     lose — it would silently clobber whichever third process legitimately
 *     linked the lease in between. Re-creating can lose, cleanly.
 *   - The contended read finding an UNPARSEABLE file still self-heals by
 *     takeover, and that is now sound: after the write-then-link publish
 *     above, no correct process can ever leave a partial or empty lease
 *     file, so unparseable means genuine corruption (or a pre-fix binary's
 *     crash residue) rather than a race we are misreading.
 *   - Any other read error (`EACCES`, `EISDIR`, `EIO`) propagates. It used
 *     to be swallowed into "no holder", i.e. an unreadable lease
 *     fail-OPENED into a takeover.
 *
 * Residual race (documented, not exercised by this phase's mandated
 * tests): two processes can both independently pass eligibility and both
 * `rename()` in quick succession; whichever rename lands last silently
 * wins the file. As long as each process's post-rename verification read
 * happens strictly after both renames land, the loser's read observes the
 * winner's record and correctly reports `LeaseAcquireRaceLostError` for
 * itself — but if the loser's read is scheduled between the two `rename()`
 * calls, it will (incorrectly) observe its own just-written data and
 * believe it won too. Closing this fully requires an OS-level lock this
 * module does not use; production hardening should add one (e.g. a
 * short-lived `${path}.takeover-lock` `O_EXCL` mutex guarding the
 * eligibility-check + rename critical section). UNCHANGED by the
 * VALIDATION ROUND (2026-07-18) pass — this is the already-documented
 * residual explicitly left as-is (see docs/evidence/phase-04/README.md's
 * Deviations #3), distinct from MAJOR 2 (the out-of-band-deletion /
 * unguarded-renew defect, fixed in `lease.ts`'s `#renew`).
 */
export async function tryAcquireOnce(
  leasePath: string,
  record: LeaseRecord,
  clock: LeaseClock,
  readProcessStartTime: ProcessStartTimeReader,
  hooks?: TryAcquireHooks,
): Promise<TryAcquireResult> {
  const payload = JSON.stringify(record);

  for (let publishAttempt = 0; publishAttempt < MAX_PUBLISH_ATTEMPTS; publishAttempt++) {
    const stagePath = uniqueSiblingPath(leasePath, "stage", record.pid, clock.now());
    if ((await publishExclusive(leasePath, payload, stagePath, hooks)) === "published") {
      return { status: "acquired", record };
    }

    await hooks?.beforeContendedRead?.();
    let existingRaw: string;
    try {
      existingRaw = await readFile(leasePath, "utf8");
    } catch (err) {
      if (!isErrnoException(err) || err.code !== "ENOENT") throw err;
      // The holder released between our failed link and this read. Only
      // ENOENT means genuinely absent — go back to the create, which can
      // lose cleanly, instead of the rename takeover, which cannot.
      continue;
    }
    const existingRecord = parseLeaseRecord(existingRaw);

    let recordedProcessStillAlive = false;
    if (existingRecord !== undefined) {
      const currentStartTime = await readProcessStartTime(existingRecord.pid);
      recordedProcessStillAlive =
        currentStartTime !== undefined && currentStartTime === existingRecord.startTimeTicks;
    }

    if (!isTakeoverEligible(existingRecord, clock.now(), recordedProcessStillAlive)) {
      return { status: "denied", error: new LeaseHeldError(leasePath, existingRecord) };
    }

    await hooks?.beforeTakeoverWrite?.();
    const tmpPath = uniqueSiblingPath(leasePath, "tmp", record.pid, clock.now());
    await stageExclusive(tmpPath, payload);
    await rename(tmpPath, leasePath);

    const verifyRaw = await readFile(leasePath, "utf8").catch(() => undefined);
    const verifyRecord = verifyRaw === undefined ? undefined : parseLeaseRecord(verifyRaw);
    const won =
      verifyRecord !== undefined &&
      verifyRecord.pid === record.pid &&
      verifyRecord.startTimeTicks === record.startTimeTicks &&
      verifyRecord.acquiredAtMs === record.acquiredAtMs;

    return won
      ? { status: "acquired", record }
      : { status: "denied", error: new LeaseAcquireRaceLostError(leasePath) };
  }

  // Exhausted: the lease path kept appearing (losing our link) and then
  // vanishing (nothing to defer to) for every pass. Nothing here has
  // acquired anything, so report the race as lost rather than claim it.
  return { status: "denied", error: new LeaseAcquireRaceLostError(leasePath) };
}
