import { z } from "zod";

/**
 * On-disk lease record contract (roadmap/04-journal-idempotency-leases.md
 * work item 6: "Lease file created with O_EXCL ... contents = PID +
 * process start time + expiry metadata (JSON)"). `startTimeTicks` is the
 * holder's `/proc/<pid>/stat` field-22 value (jiffies since boot, see
 * `./lease-proc-stat.ts`) — used together with `pid` to distinguish the
 * SAME process that wrote this record from a later, unrelated process that
 * happens to be recycled onto the same numeric pid.
 */
export const LeaseRecordSchema = z.object({
  schemaVersion: z.literal(1),
  projectHash: z.string().min(1),
  pid: z.number().int().positive(),
  startTimeTicks: z.number().int().nonnegative(),
  heartbeatIntervalMs: z.number().int().positive(),
  acquiredAtMs: z.number().int().nonnegative(),
  renewedAtMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative(),
});
export type LeaseRecord = z.infer<typeof LeaseRecordSchema>;

export interface BuildLeaseRecordParams {
  readonly projectHash: string;
  readonly pid: number;
  readonly startTimeTicks: number;
  readonly nowMs: number;
  readonly ttlMs: number;
  readonly heartbeatIntervalMs: number;
}

/** Pure constructor for a fresh lease record's contents at acquire time. */
export function buildLeaseRecord(params: BuildLeaseRecordParams): LeaseRecord {
  return LeaseRecordSchema.parse({
    schemaVersion: 1,
    projectHash: params.projectHash,
    pid: params.pid,
    startTimeTicks: params.startTimeTicks,
    heartbeatIntervalMs: params.heartbeatIntervalMs,
    acquiredAtMs: params.nowMs,
    renewedAtMs: params.nowMs,
    expiresAtMs: params.nowMs + params.ttlMs,
  });
}

/**
 * Pure: a renewed copy of `record` with `renewedAtMs`/`expiresAtMs`
 * advanced to `nowMs` (+`ttlMs`). Never mutates `record` — returns a fresh
 * object, per this repo's immutability convention.
 */
export function renewLeaseRecord(record: LeaseRecord, nowMs: number, ttlMs: number): LeaseRecord {
  return LeaseRecordSchema.parse({
    ...record,
    renewedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  });
}

/**
 * Parses raw lease-file bytes into a `LeaseRecord`, never throwing — a
 * corrupt or partially-written file (e.g. a crash mid-`writeFile`, or bytes
 * from an unrelated schema version) is indistinguishable, for takeover
 * purposes, from "no usable prior claim": this returns `undefined` rather
 * than a value the takeover logic could mistakenly trust.
 */
export function parseLeaseRecord(raw: string): LeaseRecord | undefined {
  try {
    const parsed = LeaseRecordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Pure: whether `record`'s expiry has passed as of `nowMs` (inclusive). */
export function isLeaseExpired(record: LeaseRecord, nowMs: number): boolean {
  return nowMs >= record.expiresAtMs;
}

/**
 * Pure takeover decision (roadmap/04-journal-idempotency-leases.md work
 * item 6 + Exit criteria: "takeover ONLY when lease is expired AND
 * start-time mismatch, never against a live process"). Makes no I/O calls
 * itself and trusts whatever the caller passed for
 * `recordedProcessStillAlive` — the caller is expected to compute it as
 * "does the OS-reported start time for `record.pid`, read right now, still
 * equal `record.startTimeTicks`."
 *
 * This is exactly what the fast-check property suite (lease-record.test.ts)
 * exploits: it forges arbitrary `record`/`nowMs` combinations — including
 * absurdly-far-past `expiresAtMs` values, i.e. a forged/corrupted record
 * that CLAIMS to be long expired — and asserts that whenever
 * `recordedProcessStillAlive` is `true`, the answer is always `false`,
 * regardless of how expired or fraudulent the rest of the record looks. A
 * lease is only ever eligible for takeover when BOTH conditions hold:
 * unparseable/missing (nothing to protect), or expired AND confirmed dead.
 */
export function isTakeoverEligible(
  record: LeaseRecord | undefined,
  nowMs: number,
  recordedProcessStillAlive: boolean,
): boolean {
  if (record === undefined) return true;
  if (recordedProcessStillAlive) return false;
  return isLeaseExpired(record, nowMs);
}
