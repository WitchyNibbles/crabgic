import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildLeaseRecord,
  isLeaseExpired,
  isTakeoverEligible,
  LeaseRecordSchema,
  parseLeaseRecord,
  renewLeaseRecord,
  type LeaseRecord,
} from "./lease-record.js";

const BASE_PARAMS = {
  projectHash: "project-hash-abc",
  pid: 4242,
  startTimeTicks: 123456,
  nowMs: 1_000_000,
  ttlMs: 15_000,
  heartbeatIntervalMs: 5_000,
} as const;

describe("buildLeaseRecord / renewLeaseRecord — unit", () => {
  it("builds a schema-valid record with expiry = nowMs + ttlMs", () => {
    const record = buildLeaseRecord(BASE_PARAMS);
    expect(record.schemaVersion).toBe(1);
    expect(record.pid).toBe(BASE_PARAMS.pid);
    expect(record.startTimeTicks).toBe(BASE_PARAMS.startTimeTicks);
    expect(record.acquiredAtMs).toBe(BASE_PARAMS.nowMs);
    expect(record.renewedAtMs).toBe(BASE_PARAMS.nowMs);
    expect(record.expiresAtMs).toBe(BASE_PARAMS.nowMs + BASE_PARAMS.ttlMs);
  });

  it("renewLeaseRecord never mutates its input and advances renewedAtMs/expiresAtMs only", () => {
    const original = buildLeaseRecord(BASE_PARAMS);
    const snapshot = { ...original };
    const renewed = renewLeaseRecord(original, 2_000_000, 20_000);

    expect(original).toEqual(snapshot);
    expect(renewed.renewedAtMs).toBe(2_000_000);
    expect(renewed.expiresAtMs).toBe(2_020_000);
    expect(renewed.pid).toBe(original.pid);
    expect(renewed.startTimeTicks).toBe(original.startTimeTicks);
    expect(renewed.acquiredAtMs).toBe(original.acquiredAtMs);
  });
});

describe("parseLeaseRecord — corrupt-file handling", () => {
  it("round-trips a record built by buildLeaseRecord", () => {
    const record = buildLeaseRecord(BASE_PARAMS);
    const parsed = parseLeaseRecord(JSON.stringify(record));
    expect(parsed).toEqual(record);
  });

  it("returns undefined for invalid JSON (truncated / torn write)", () => {
    expect(parseLeaseRecord('{"pid": 42, "schemaVer')).toBeUndefined();
    expect(parseLeaseRecord("")).toBeUndefined();
    expect(parseLeaseRecord("not json at all")).toBeUndefined();
  });

  it("returns undefined for valid JSON that does not match the schema (missing fields)", () => {
    expect(parseLeaseRecord(JSON.stringify({ pid: 42 }))).toBeUndefined();
  });

  it("returns undefined for valid JSON with wrong field types", () => {
    expect(
      parseLeaseRecord(
        JSON.stringify({
          ...buildLeaseRecord(BASE_PARAMS),
          pid: "not-a-number",
        }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined for an unrecognized schemaVersion", () => {
    expect(
      parseLeaseRecord(JSON.stringify({ ...buildLeaseRecord(BASE_PARAMS), schemaVersion: 2 })),
    ).toBeUndefined();
  });
});

describe("isLeaseExpired — unit", () => {
  it("is false strictly before expiresAtMs and true at/after it (inclusive boundary)", () => {
    const record = buildLeaseRecord(BASE_PARAMS);
    expect(isLeaseExpired(record, record.expiresAtMs - 1)).toBe(false);
    expect(isLeaseExpired(record, record.expiresAtMs)).toBe(true);
    expect(isLeaseExpired(record, record.expiresAtMs + 1)).toBe(true);
  });
});

describe("isTakeoverEligible — unit (roadmap/04 work item 6 + exit criteria)", () => {
  const record = buildLeaseRecord(BASE_PARAMS);

  it("is eligible when there is no existing record to protect", () => {
    expect(isTakeoverEligible(undefined, 0, false)).toBe(true);
    expect(isTakeoverEligible(undefined, Number.MAX_SAFE_INTEGER, true)).toBe(true);
  });

  it("is never eligible while the recorded process is confirmed still alive, expired or not", () => {
    expect(isTakeoverEligible(record, record.expiresAtMs - 1, true)).toBe(false);
    expect(isTakeoverEligible(record, record.expiresAtMs + 1_000_000, true)).toBe(false);
  });

  it("is not eligible before expiry even when the process cannot be confirmed alive", () => {
    expect(isTakeoverEligible(record, record.expiresAtMs - 1, false)).toBe(false);
  });

  it("is eligible only once expired AND the process is confirmed not alive (dead or recycled pid)", () => {
    expect(isTakeoverEligible(record, record.expiresAtMs, false)).toBe(true);
    expect(isTakeoverEligible(record, record.expiresAtMs + 1, false)).toBe(true);
  });
});

const leaseRecordArbitrary: fc.Arbitrary<LeaseRecord> = fc
  .record({
    schemaVersion: fc.constant(1 as const),
    projectHash: fc.string({ minLength: 1, maxLength: 40 }),
    pid: fc.integer({ min: 1, max: 2 ** 31 - 1 }),
    startTimeTicks: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    heartbeatIntervalMs: fc.integer({ min: 1, max: 100_000 }),
    acquiredAtMs: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    renewedAtMs: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    expiresAtMs: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  })
  .map((candidate) => LeaseRecordSchema.parse(candidate));

describe("isTakeoverEligible — fast-check property (forged PID/start-time never wins takeover)", () => {
  it("never allows takeover when the recorded process is confirmed still alive, for any forged record/clock combination", () => {
    fc.assert(
      fc.property(
        leaseRecordArbitrary,
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (forgedRecord, nowMs) => {
          expect(isTakeoverEligible(forgedRecord, nowMs, true)).toBe(false);
        },
      ),
      { numRuns: 5_000 },
    );
  });

  it("matches the exact reference truth table: eligible iff (not alive) AND expired, for any record/clock/liveness combination", () => {
    fc.assert(
      fc.property(
        leaseRecordArbitrary,
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.boolean(),
        (forgedRecord, nowMs, recordedProcessStillAlive) => {
          const eligible = isTakeoverEligible(forgedRecord, nowMs, recordedProcessStillAlive);
          const expired = nowMs >= forgedRecord.expiresAtMs;
          expect(eligible).toBe(!recordedProcessStillAlive && expired);
        },
      ),
      { numRuns: 5_000 },
    );
  });
});
