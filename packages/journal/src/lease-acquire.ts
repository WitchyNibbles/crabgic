/**
 * `tryAcquireOnce` and its private helpers — split out of `lease.ts` to
 * keep that file under this repo's file-size convention (VALIDATION ROUND
 * 2026-07-18, MAJOR 2 fix added enough self-defense logic to `lease.ts`
 * that its acquisition-attempt path was extracted here, mirroring the
 * existing `lease-record.ts`/`lease-proc-stat.ts` split). `Lease.acquire`
 * (in `lease.ts`) is the only caller.
 */

import { open, readFile, rename } from "node:fs/promises";
import { LeaseAcquireRaceLostError, LeaseHeldError } from "./lease-errors.js";
import { isTakeoverEligible, parseLeaseRecord, type LeaseRecord } from "./lease-record.js";
import type { ProcessStartTimeReader } from "./lease-proc-stat.js";

export interface LeaseClock {
  readonly now: () => number;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

/**
 * Atomically creates `path` (fails `EEXIST` if it already exists — see
 * `man 2 open`, `O_EXCL`) and writes+syncs `payload`. This is what makes
 * two processes racing `Lease.acquire` for the same brand-new lease path
 * resolve to exactly one winner at the kernel level (roadmap/04 work item
 * 6's exit criterion). An earlier, deliberately naive version of this
 * function (`writeFile(path, payload, "utf8")` — no O_EXCL, blind
 * overwrite) was used to capture the required failing-first evidence; see
 * docs/evidence/phase-04/wi6-lease-{failing,passing}.txt.
 */
export async function writeExclusive(path: string, payload: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
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
 * A single acquisition attempt. Fast path: `open(path, "wx")` — the O_EXCL
 * flag makes file creation atomic at the kernel level, so when two
 * processes race this call for the same brand-new lease path, exactly one
 * `open` succeeds and the other fails `EEXIST` — this is the property the
 * two-real-child-process integration test in `lease.test.ts` exercises
 * directly (roadmap/04's exit criterion for this work item).
 *
 * Contended path (file already exists): read + parse the existing record,
 * ask the caller-injected `readProcessStartTime` whether its pid is still
 * running with the same start time, and defer to the pure
 * `isTakeoverEligible` decision. A takeover writes a fresh record to a
 * uniquely-named temp file, `rename()`s it over the lease path (POSIX
 * `rename` is an atomic replace), then reads the path back and confirms it
 * is the record THIS attempt just wrote.
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
): Promise<TryAcquireResult> {
  const payload = JSON.stringify(record);

  try {
    await writeExclusive(leasePath, payload);
    return { status: "acquired", record };
  } catch (err) {
    if (!isErrnoException(err) || err.code !== "EEXIST") throw err;
  }

  const existingRaw = await readFile(leasePath, "utf8").catch(() => undefined);
  const existingRecord = existingRaw === undefined ? undefined : parseLeaseRecord(existingRaw);

  let recordedProcessStillAlive = false;
  if (existingRecord !== undefined) {
    const currentStartTime = await readProcessStartTime(existingRecord.pid);
    recordedProcessStillAlive =
      currentStartTime !== undefined && currentStartTime === existingRecord.startTimeTicks;
  }

  if (!isTakeoverEligible(existingRecord, clock.now(), recordedProcessStillAlive)) {
    return { status: "denied", error: new LeaseHeldError(leasePath, existingRecord) };
  }

  const tmpPath = `${leasePath}.tmp-${record.pid}-${clock.now()}-${Math.random().toString(36).slice(2)}`;
  await writeExclusive(tmpPath, payload);
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
