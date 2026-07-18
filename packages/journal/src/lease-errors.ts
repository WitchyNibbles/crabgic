/**
 * `Lease`'s typed error classes — split out of `lease.ts` to keep that file
 * under this repo's file-size convention (VALIDATION ROUND 2026-07-18,
 * MAJOR 2 fix added enough self-defense logic to `lease.ts` that its error
 * classes were extracted here, mirroring the existing `lease-record.ts`/
 * `lease-proc-stat.ts` split).
 */

import type { LeaseRecord } from "./lease-record.js";

export class LeaseHeldError extends Error {
  readonly leasePath: string;
  readonly holder: LeaseRecord | undefined;
  constructor(leasePath: string, holder: LeaseRecord | undefined) {
    super(
      holder === undefined
        ? `lease: "${leasePath}" is held by an unparseable/corrupt record not yet eligible for takeover`
        : `lease: "${leasePath}" is held by pid ${holder.pid} (start time ${holder.startTimeTicks}), not expired or still live`,
    );
    this.name = "LeaseHeldError";
    this.leasePath = leasePath;
    this.holder = holder;
  }
}

export class LeaseAcquireRaceLostError extends Error {
  readonly leasePath: string;
  constructor(leasePath: string) {
    super(`lease: "${leasePath}" takeover race lost to a concurrent acquirer`);
    this.name = "LeaseAcquireRaceLostError";
    this.leasePath = leasePath;
  }
}

export type LeaseLostReason = "missing" | "ownership_mismatch" | "transient_ttl_exceeded";

/**
 * VALIDATION ROUND (2026-07-18) fix, MAJOR 2: thrown by `renewNow()` (and
 * recorded as `lostReason`/surfaced to `onLeaseLost`) once this holder no
 * longer safely owns the on-disk lease file — either because the file is
 * missing/was replaced by a different holder's record (`"missing"` /
 * `"ownership_mismatch"`), or because renewal has been failing with a
 * transient filesystem error for at least `ttlMs` (`"transient_ttl_
 * exceeded"` — the policy documented on `Lease`'s own class doc comment in
 * `lease.ts`). `held` is `false` by the time this is observable.
 */
export class LeaseLostError extends Error {
  readonly leasePath: string;
  readonly reason: LeaseLostReason;
  constructor(leasePath: string, reason: LeaseLostReason) {
    super(
      `lease: "${leasePath}" lost (${reason}) — this holder no longer safely owns the lease and must stop treating itself as the exclusive supervisor`,
    );
    this.name = "LeaseLostError";
    this.leasePath = leasePath;
    this.reason = reason;
  }
}
