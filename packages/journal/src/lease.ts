import { mkdir, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  LeaseAcquireRaceLostError,
  LeaseHeldError,
  LeaseLostError,
  type LeaseLostReason,
} from "./lease-errors.js";
import { delay, tryAcquireOnce, writeExclusive, type LeaseClock } from "./lease-acquire.js";
import {
  buildLeaseRecord,
  parseLeaseRecord,
  renewLeaseRecord,
  type LeaseRecord,
} from "./lease-record.js";
import { readProcessStartTimeFromProc, type ProcessStartTimeReader } from "./lease-proc-stat.js";

export { LeaseAcquireRaceLostError, LeaseHeldError, LeaseLostError };
export type { LeaseLostReason };
export type { LeaseClock } from "./lease-acquire.js";

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
// 3 missed heartbeats before a holder is considered stale enough to even
// consider takeover — takeover additionally requires the recorded pid's
// start time to no longer match (see `isTakeoverEligible`).
export const DEFAULT_LEASE_TTL_MS = DEFAULT_HEARTBEAT_INTERVAL_MS * 3;

const SYSTEM_CLOCK: LeaseClock = { now: () => Date.now() };

export interface LeaseAcquireOptions {
  readonly pid?: number;
  readonly ttlMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly clock?: LeaseClock;
  readonly readProcessStartTime?: ProcessStartTimeReader;
  /** Starts the automatic `heartbeatIntervalMs`-cadence renewal timer on a successful acquire. Default `true`. */
  readonly autoRenew?: boolean;
  /** How many acquisition attempts to make before giving up. Default `1` (no retry). */
  readonly maxAcquireAttempts?: number;
  readonly retryDelayMs?: number;
  /**
   * VALIDATION ROUND (2026-07-18) fix, MAJOR 2: invoked (synchronously,
   * from within the background heartbeat) the moment this lease
   * transitions from held to lost — ownership-mismatch/missing loss is
   * reported immediately; a transient fs error is only reported once it
   * has persisted for at least `ttlMs`. Never invoked for an explicit
   * `release()`. A caller that never awaits `renewNow()` directly (the
   * documented pattern for the automatic background heartbeat — see
   * `#startHeartbeat`'s own doc comment) should use this callback (or poll
   * `held`/`lostReason`) to notice loss.
   */
  readonly onLeaseLost?: (err: LeaseLostError) => void;
}

function leaseFileName(projectHash: string): string {
  return `${projectHash}.lease.json`;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Per-project exclusive lease (roadmap/04-journal-idempotency-leases.md
 * work item 6). `leaseDir` is an EXPLICIT constructor argument — this
 * module owns none of the `$XDG_STATE_HOME` layout constants (a different
 * work item's module); callers pass whatever `leaseDir` they resolved.
 */
export class Lease {
  readonly leaseDir: string;
  readonly leasePath: string;
  readonly projectHash: string;
  readonly pid: number;

  #record: LeaseRecord;
  #released = false;
  #heartbeat: NodeJS.Timeout | undefined;
  readonly #clock: LeaseClock;
  readonly #ttlMs: number;
  readonly #heartbeatIntervalMs: number;
  readonly #onLeaseLost: ((err: LeaseLostError) => void) | undefined;

  // VALIDATION ROUND (2026-07-18) fix, MAJOR 2 state:
  #lastHeartbeatError: Error | undefined;
  #lostReason: LeaseLostReason | undefined;
  /** Set on the FIRST transient (non-ownership) renew failure; cleared on the next successful renew. Used to implement the "transient fs error -> lost only after the TTL would have elapsed" policy. */
  #firstTransientFailureAtMs: number | undefined;

  private constructor(
    leaseDir: string,
    leasePath: string,
    projectHash: string,
    pid: number,
    record: LeaseRecord,
    clock: LeaseClock,
    ttlMs: number,
    heartbeatIntervalMs: number,
    onLeaseLost: ((err: LeaseLostError) => void) | undefined,
  ) {
    this.leaseDir = leaseDir;
    this.leasePath = leasePath;
    this.projectHash = projectHash;
    this.pid = pid;
    this.#record = record;
    this.#clock = clock;
    this.#ttlMs = ttlMs;
    this.#heartbeatIntervalMs = heartbeatIntervalMs;
    this.#onLeaseLost = onLeaseLost;
  }

  /** `true` until `release()` has completed OR this holder is detected to have lost the lease (out-of-band replacement, or a transient renew failure persisting past the TTL); `false` after either. */
  get held(): boolean {
    return !this.#released;
  }

  /** The most recently written record (post-acquire or post-renew). */
  get record(): LeaseRecord {
    return this.#record;
  }

  /** The most recent renewal failure observed (ownership-mismatch, missing, or transient fs error) — `undefined` if every renewal so far has succeeded. Cleared on the next successful renewal. */
  get lastHeartbeatError(): Error | undefined {
    return this.#lastHeartbeatError;
  }

  /** Why this lease was lost (`held === false` and it was never explicitly `release()`d) — `undefined` if still held, or if `release()` was called explicitly. */
  get lostReason(): LeaseLostReason | undefined {
    return this.#lostReason;
  }

  static async acquire(
    leaseDir: string,
    projectHash: string,
    opts: LeaseAcquireOptions = {},
  ): Promise<Lease> {
    const clock = opts.clock ?? SYSTEM_CLOCK;
    const pid = opts.pid ?? process.pid;
    const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    const ttlMs = opts.ttlMs ?? DEFAULT_LEASE_TTL_MS;
    const readProcessStartTime = opts.readProcessStartTime ?? readProcessStartTimeFromProc;
    const maxAttempts = Math.max(1, opts.maxAcquireAttempts ?? 1);
    const retryDelayMs = opts.retryDelayMs ?? 0;

    await mkdir(leaseDir, { recursive: true, mode: 0o700 });
    const leasePath = join(leaseDir, leaseFileName(projectHash));
    // Own start time is read once, up front — it never changes for the
    // lifetime of this process. Falls back to `clock.now()` off-Linux
    // (no `/proc`), a documented degraded mode: start-time-based takeover
    // protection is a Linux-only guarantee (roadmap/04's own scope note).
    const startTimeTicks = (await readProcessStartTime(pid)) ?? clock.now();

    let lastError: Error = new LeaseHeldError(leasePath, undefined);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const record = buildLeaseRecord({
        projectHash,
        pid,
        startTimeTicks,
        nowMs: clock.now(),
        ttlMs,
        heartbeatIntervalMs,
      });
      const outcome = await tryAcquireOnce(leasePath, record, clock, readProcessStartTime);
      if (outcome.status === "acquired" && outcome.record !== undefined) {
        const lease = new Lease(
          leaseDir,
          leasePath,
          projectHash,
          pid,
          outcome.record,
          clock,
          ttlMs,
          heartbeatIntervalMs,
          opts.onLeaseLost,
        );
        if (opts.autoRenew ?? true) lease.#startHeartbeat();
        return lease;
      }
      lastError = outcome.error ?? lastError;
      if (attempt < maxAttempts - 1) await delay(retryDelayMs);
    }
    throw lastError;
  }

  /**
   * VALIDATION ROUND (2026-07-18) fix, MAJOR 2: a failed background
   * renewal still has no caller to reject a promise to (unchanged from
   * before this fix), but the failure is NO LONGER silently discarded —
   * `#renew` itself always records `#lastHeartbeatError`/`#lostReason` and
   * invokes `onLeaseLost` (via `#markLost`) before this `.catch()` ever
   * runs, so state is never lost even though nothing here awaits/rejects
   * on it. Production supervisors (05) are expected to poll
   * `held`/`lastHeartbeatError`/`lostReason`, or pass `onLeaseLost`, rather
   * than await this timer directly.
   */
  #startHeartbeat(): void {
    this.#heartbeat = setInterval(() => {
      this.#renew().catch(() => {
        // Intentionally empty: `#renew` already recorded/reported the
        // failure above before this rejection reaches here.
      });
    }, this.#heartbeatIntervalMs);
    this.#heartbeat.unref();
  }

  /**
   * VALIDATION ROUND (2026-07-18) fix, MAJOR 2: `#renew` now revalidates
   * ownership of the on-disk record BEFORE replacing it — asymmetric with
   * `#release()`'s own long-standing `stillOurs` check was exactly the
   * defect (see this file's own `tryAcquireOnce` doc comment for the
   * sibling documented takeover-race residual, which this fix does NOT
   * touch or change scope of).
   *
   * Policy (documented, settled):
   *   - Missing or owned by a DIFFERENT record (pid/startTimeTicks/
   *     acquiredAtMs mismatch) -> lost IMMEDIATELY. Nothing is written —
   *     never risk clobbering whichever legitimate holder now owns the
   *     file.
   *   - A transient filesystem error (the ownership READ itself fails
   *     with something other than "file genuinely doesn't exist", or the
   *     write/rename fails) -> lost only once such failures have persisted
   *     continuously for at least `ttlMs` (the same duration a live holder
   *     is normally trusted for) — a single blip does not surrender the
   *     lease. `held` stays `true` and this rejects with the raw
   *     underlying error (not `LeaseLostError`) until the TTL is actually
   *     exceeded.
   */
  async #renew(): Promise<void> {
    if (this.#released) return;
    const nowMs = this.#clock.now();

    let currentRecord: LeaseRecord | undefined;
    try {
      const currentRaw = await readFile(this.leasePath, "utf8");
      currentRecord = parseLeaseRecord(currentRaw);
    } catch (err) {
      if (isErrnoException(err) && err.code === "ENOENT") {
        currentRecord = undefined; // genuinely missing — not a transient failure
      } else {
        this.#handleTransientFailure(nowMs, toError(err));
        if (this.#released) throw new LeaseLostError(this.leasePath, "transient_ttl_exceeded");
        throw err;
      }
    }

    const stillOurs =
      currentRecord !== undefined &&
      currentRecord.pid === this.#record.pid &&
      currentRecord.startTimeTicks === this.#record.startTimeTicks &&
      currentRecord.acquiredAtMs === this.#record.acquiredAtMs;

    if (!stillOurs) {
      const reason: LeaseLostReason =
        currentRecord === undefined ? "missing" : "ownership_mismatch";
      this.#markLost(reason);
      throw new LeaseLostError(this.leasePath, reason);
    }

    const renewed = renewLeaseRecord(this.#record, nowMs, this.#ttlMs);
    const tmpPath = `${this.leasePath}.tmp-renew-${this.pid}-${nowMs}`;
    try {
      await writeExclusive(tmpPath, JSON.stringify(renewed));
      await rename(tmpPath, this.leasePath);
    } catch (err) {
      this.#handleTransientFailure(nowMs, toError(err));
      if (this.#released) throw new LeaseLostError(this.leasePath, "transient_ttl_exceeded");
      throw err;
    }

    this.#record = renewed;
    this.#firstTransientFailureAtMs = undefined;
    this.#lastHeartbeatError = undefined;
  }

  #handleTransientFailure(nowMs: number, err: Error): void {
    this.#lastHeartbeatError = err;
    if (this.#firstTransientFailureAtMs === undefined) {
      this.#firstTransientFailureAtMs = nowMs;
    }
    if (nowMs - this.#firstTransientFailureAtMs >= this.#ttlMs) {
      this.#markLost("transient_ttl_exceeded");
    }
  }

  /** Transitions `held` to `false` due to loss (NOT an explicit `release()`), stops the heartbeat, and reports via `onLeaseLost`. Idempotent. Never writes to or deletes the lease file — see this fix's own MAJOR 2 doc comment: the whole point is to never clobber whichever holder legitimately owns it now. */
  #markLost(reason: LeaseLostReason): void {
    if (this.#released) return;
    this.#released = true;
    this.#lostReason = reason;
    if (this.#heartbeat !== undefined) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = undefined;
    }
    const err = new LeaseLostError(this.leasePath, reason);
    this.#lastHeartbeatError = err;
    this.#onLeaseLost?.(err);
  }

  /** Explicitly renews now, outside the automatic heartbeat interval — exposed for deterministic tests (see lease.test.ts). Rejects with `LeaseLostError` (ownership lost) or the raw transient error (renewal failed but the lease is not yet lost). */
  async renewNow(): Promise<void> {
    return this.#renew();
  }

  async release(): Promise<void> {
    return this.#release();
  }

  async #release(): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    if (this.#heartbeat !== undefined) clearInterval(this.#heartbeat);

    // Only unlink if the file still holds OUR record: if a takeover
    // already replaced it (this holder's TTL lapsed before this release
    // call ran), deleting it would destroy the new legitimate holder's
    // lease — releasing a lease we no longer hold must be a no-op, not a
    // destructive act.
    const currentRaw = await readFile(this.leasePath, "utf8").catch(() => undefined);
    const currentRecord = currentRaw === undefined ? undefined : parseLeaseRecord(currentRaw);
    const stillOurs =
      currentRecord !== undefined &&
      currentRecord.pid === this.#record.pid &&
      currentRecord.startTimeTicks === this.#record.startTimeTicks &&
      currentRecord.acquiredAtMs === this.#record.acquiredAtMs;

    if (stillOurs) {
      await unlink(this.leasePath).catch(() => {
        // Already gone — a concurrent reader raced the same cleanup; releasing twice is a no-op.
      });
    }
  }
}
