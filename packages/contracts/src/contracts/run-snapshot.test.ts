import { describe, expect, it } from "vitest";
import { RunSnapshotSchema } from "./run-snapshot.js";
import { RUN_LIFECYCLE_STATES } from "../state-machines/run-lifecycle.js";

const ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const CHANGE_SET_ID = "33333333-3333-4333-8333-333333333333";

function validRunSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: ID,
    runId: RUN_ID,
    changeSetId: CHANGE_SET_ID,
    runState: "running",
    journalSequenceNumber: 42,
    capturedAt: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("RunSnapshotSchema", () => {
  it("parses a fully-valid fixture", () => {
    const result = RunSnapshotSchema.safeParse(validRunSnapshot());
    expect(result.success).toBe(true);
  });

  it("rejects an invalid-shape fixture (missing required runId)", () => {
    const fixture = validRunSnapshot();
    delete fixture.runId;
    const result = RunSnapshotSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it("rejects a negative journalSequenceNumber", () => {
    const result = RunSnapshotSchema.safeParse(validRunSnapshot({ journalSequenceNumber: -1 }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer journalSequenceNumber", () => {
    const result = RunSnapshotSchema.safeParse(validRunSnapshot({ journalSequenceNumber: 1.5 }));
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key (.strict())", () => {
    const result = RunSnapshotSchema.safeParse({ ...validRunSnapshot(), unexpectedField: "nope" });
    expect(result.success).toBe(false);
  });

  it("rejects a runState outside the run-lifecycle closed union", () => {
    const result = RunSnapshotSchema.safeParse(validRunSnapshot({ runState: "archived" }));
    expect(result.success).toBe(false);
  });

  it("accepts every run-lifecycle state as RunSnapshot.runState (11 members, reused union, never re-typed)", () => {
    expect(RUN_LIFECYCLE_STATES.length).toBe(11);
    for (const runState of RUN_LIFECYCLE_STATES) {
      const result = RunSnapshotSchema.safeParse(validRunSnapshot({ runState }));
      expect(result.success).toBe(true);
    }
  });

  it("round-trips through JSON.stringify/JSON.parse deep-equal", () => {
    const original = RunSnapshotSchema.parse(validRunSnapshot({ runState: "verifying" }));
    const revived = RunSnapshotSchema.parse(JSON.parse(JSON.stringify(original)) as unknown);
    expect(revived).toEqual(original);
  });
});
