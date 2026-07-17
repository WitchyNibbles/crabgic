import { describe, expect, it } from "vitest";
import {
  REMOTE_OPERATION_RECORD_STATUSES,
  RemoteOperationRecordSchema,
} from "./remote-operation-record.js";

const validRecord = {
  schemaVersion: 1,
  id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
  remoteMutationPlanId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  operationId: "run-42:work-unit-7:issue-transition-1",
  contentHash: "sha256:9f3e...",
  status: "recorded",
  appliedRevision: "rev-18",
  recordedAt: "2026-07-15T12:00:00.000Z",
};

describe("RemoteOperationRecordSchema — valid fixture", () => {
  it("parses a fully-valid fixture (roadmap/04 §In scope, Idempotency registry; roadmap/16 Mutation pipeline)", () => {
    expect(RemoteOperationRecordSchema.safeParse(validRecord).success).toBe(true);
  });

  it("accepts a pre-network-I/O pending record with no appliedRevision yet", () => {
    const { appliedRevision: _rev, ...rest } = validRecord;
    const pending = { ...rest, status: "pending" };
    expect(RemoteOperationRecordSchema.safeParse(pending).success).toBe(true);
  });

  it("accepts a conflict record carrying a canonical errorKind", () => {
    const { appliedRevision: _rev, ...rest } = validRecord;
    const conflict = { ...rest, status: "conflict", errorKind: "conflict" };
    expect(RemoteOperationRecordSchema.safeParse(conflict).success).toBe(true);
  });
});

describe("RemoteOperationRecordSchema — all status union branches", () => {
  it("has exactly 6 statuses", () => {
    expect(REMOTE_OPERATION_RECORD_STATUSES.length).toBe(6);
  });

  it.each(REMOTE_OPERATION_RECORD_STATUSES)("accepts status %s", (status) => {
    const { appliedRevision: _rev, ...rest } = validRecord;
    expect(RemoteOperationRecordSchema.safeParse({ ...rest, status }).success).toBe(true);
  });

  it("rejects a status outside the closed union", () => {
    expect(
      RemoteOperationRecordSchema.safeParse({ ...validRecord, status: "unknown" }).success,
    ).toBe(false);
  });
});

describe("RemoteOperationRecordSchema — invalid-shape rejection", () => {
  it("rejects a missing schemaVersion", () => {
    const { schemaVersion: _schemaVersion, ...rest } = validRecord;
    expect(RemoteOperationRecordSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a non-uuid remoteMutationPlanId", () => {
    expect(
      RemoteOperationRecordSchema.safeParse({ ...validRecord, remoteMutationPlanId: "not-a-uuid" })
        .success,
    ).toBe(false);
  });

  it("rejects an errorKind outside the canonical 10-member connector-error union", () => {
    expect(
      RemoteOperationRecordSchema.safeParse({ ...validRecord, errorKind: "timeout" }).success,
    ).toBe(false);
  });

  it("rejects an empty operationId", () => {
    expect(RemoteOperationRecordSchema.safeParse({ ...validRecord, operationId: "" }).success).toBe(
      false,
    );
  });
});

describe("RemoteOperationRecordSchema — unknown-key rejection (.strict())", () => {
  it("rejects an unknown top-level key", () => {
    expect(
      RemoteOperationRecordSchema.safeParse({ ...validRecord, unexpected: "field" }).success,
    ).toBe(false);
  });
});

describe("RemoteOperationRecordSchema — round-trip", () => {
  it("parse -> JSON.stringify -> JSON.parse -> parse yields a deep-equal output", () => {
    const first = RemoteOperationRecordSchema.parse(validRecord);
    const roundTripped = RemoteOperationRecordSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped).toStrictEqual(first);
  });
});
