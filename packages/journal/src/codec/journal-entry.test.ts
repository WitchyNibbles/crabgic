import {
  JOURNAL_ENTRY_TYPES,
  WORK_UNIT_ATTEMPT_STATUSES,
  type JournalEntryType,
} from "@eo/contracts";
import { describe, expect, it } from "vitest";
import { computeEntryHash, GENESIS_PREV_HASH } from "./hash-chain.js";
import {
  CURRENT_SCHEMA_VERSION,
  FIRST_SEQ,
  JournalEntrySchema,
  type JournalEntry,
} from "./journal-entry.js";
import { decodeLine, encodeEntryToLine } from "./ndjson-codec.js";

const SAMPLE_ID = "11111111-1111-4111-8111-111111111111";
const SAMPLE_ID_2 = "22222222-2222-4222-8222-222222222222";
const SAMPLE_TIMESTAMP = "2026-01-01T00:00:00.000Z";

/** Every payload variant a valid `JournalEntry` of each of the 13 types can carry — one representative fixture per member. */
const SAMPLE_PAYLOADS: Record<JournalEntryType, unknown> = {
  run_transition: { from: "draft", to: "awaiting_approval" },
  work_unit_transition: { status: "pending" },
  adjudication_decision: { decision: "approved", rationale: "meets bar" },
  remote_operation_record: {
    schemaVersion: 1,
    id: SAMPLE_ID,
    remoteMutationPlanId: SAMPLE_ID_2,
    operationId: "op-1",
    contentHash: "sha256:deadbeef",
    status: "pending",
    recordedAt: SAMPLE_TIMESTAMP,
  },
  evidence_pointer: {
    schemaVersion: 1,
    id: SAMPLE_ID,
    changeSetId: SAMPLE_ID_2,
    command: "npm test",
    exitStatus: 0,
    toolchainFingerprint: "node@24.18.0",
    capturedAt: SAMPLE_TIMESTAMP,
    artifactDigests: ["sha256:artifact"],
    objectId: "0000000000000000000000000000000000000a",
  },
  session_assignment: { sessionId: SAMPLE_ID },
  git_freeze: { scopePath: "/repo", reason: "merge freeze" },
  worktree_quarantine: { worktreePath: "/repo/.worktrees/wt1", reason: "dirty overlap" },
  cas_ref_update: { ref: "refs/cas/abc", objectId: "deadbeef" },
  approval_token_mint: { tokenId: SAMPLE_ID, scope: "contract.approve" },
  fanout_rationale: { rationale: "balanced routing across roster" },
  milestone_sync: { provider: "jira", externalId: "PROJ-123" },
  learning_transition: { from: "observation", to: "reproducer" },
};

/** Builds a fully valid, hash-consistent `JournalEntry` for `type`, at the genesis position (seq FIRST_SEQ, prevHash GENESIS). */
function buildSampleEntry(
  type: JournalEntryType,
  payload: unknown = SAMPLE_PAYLOADS[type],
): JournalEntry {
  const draft = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    seq: FIRST_SEQ,
    type,
    payload,
    prevHash: GENESIS_PREV_HASH,
    timestamp: SAMPLE_TIMESTAMP,
    runId: SAMPLE_ID,
    changeSetId: SAMPLE_ID_2,
    workUnitId: SAMPLE_ID,
  };
  const hash = computeEntryHash(draft);
  return JournalEntrySchema.parse({ ...draft, hash });
}

describe("JournalEntrySchema — all 13 JournalEntryType members", () => {
  it("JOURNAL_ENTRY_TYPES really has 13 members (sanity on the fixture table above)", () => {
    expect(JOURNAL_ENTRY_TYPES).toHaveLength(13);
    expect(Object.keys(SAMPLE_PAYLOADS)).toHaveLength(13);
  });

  for (const type of JOURNAL_ENTRY_TYPES) {
    it(`round-trips a valid "${type}" entry through encode -> decode`, () => {
      const entry = buildSampleEntry(type);
      const line = encodeEntryToLine(entry);
      expect(line.endsWith("\n")).toBe(true);
      const decoded = decodeLine(line.slice(0, -1));
      expect(decoded).toEqual(entry);
    });

    it(`rejects a "${type}" entry whose payload doesn't match its own schema`, () => {
      const draft = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        seq: FIRST_SEQ,
        type,
        payload: { thisFieldDoesNotExistOnAnyPayload: true },
        prevHash: GENESIS_PREV_HASH,
        timestamp: SAMPLE_TIMESTAMP,
      };
      const hash = computeEntryHash(draft);
      expect(() => JournalEntrySchema.parse({ ...draft, hash })).toThrow();
    });
  }

  it("rejects an entry whose type is not one of the 13 members", () => {
    const draft = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      seq: FIRST_SEQ,
      type: "not_a_real_journal_entry_type",
      payload: {},
      prevHash: GENESIS_PREV_HASH,
      timestamp: SAMPLE_TIMESTAMP,
    };
    const hash = computeEntryHash(draft);
    expect(() => JournalEntrySchema.parse({ ...draft, hash })).toThrow();
  });

  it("rejects a payload with an extra unknown key (.strict() enforcement)", () => {
    const draft = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      seq: FIRST_SEQ,
      type: "fanout_rationale" as const,
      payload: { rationale: "ok", unexpectedExtraKey: "nope" },
      prevHash: GENESIS_PREV_HASH,
      timestamp: SAMPLE_TIMESTAMP,
    };
    const hash = computeEntryHash(draft);
    expect(() => JournalEntrySchema.parse({ ...draft, hash })).toThrow();
  });

  it("rejects prevHash/hash values that aren't 64-char lowercase hex", () => {
    const entry = buildSampleEntry("fanout_rationale");
    expect(() => JournalEntrySchema.parse({ ...entry, hash: "not-hex" })).toThrow();
    expect(() => JournalEntrySchema.parse({ ...entry, prevHash: "TOOSHORT" })).toThrow();
  });

  it("evidence_pointer payload deserializes as a full EvidenceRecord shape (02)", () => {
    const entry = buildSampleEntry("evidence_pointer");
    if (entry.type !== "evidence_pointer") throw new Error("unreachable");
    expect(entry.payload.command).toBe("npm test");
    expect(entry.payload.artifactDigests).toEqual(["sha256:artifact"]);
  });

  it("remote_operation_record payload deserializes as a full RemoteOperationRecord shape (02)", () => {
    const entry = buildSampleEntry("remote_operation_record");
    if (entry.type !== "remote_operation_record") throw new Error("unreachable");
    expect(entry.payload.operationId).toBe("op-1");
    expect(entry.payload.status).toBe("pending");
  });

  it("run_transition payload carries a (from,to) pair typed against the run-lifecycle enum", () => {
    const entry = buildSampleEntry("run_transition");
    if (entry.type !== "run_transition") throw new Error("unreachable");
    expect(entry.payload).toEqual({ from: "draft", to: "awaiting_approval" });
    const draft = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      seq: FIRST_SEQ,
      type: "run_transition" as const,
      payload: { from: "draft", to: "not_a_real_run_state" },
      prevHash: GENESIS_PREV_HASH,
      timestamp: SAMPLE_TIMESTAMP,
    };
    expect(() => JournalEntrySchema.parse({ ...draft, hash: computeEntryHash(draft) })).toThrow();
  });
});

describe("JournalEntrySchema — every WorkUnitAttemptStatus member via work_unit_transition", () => {
  it("WORK_UNIT_ATTEMPT_STATUSES really has all documented members", () => {
    expect(WORK_UNIT_ATTEMPT_STATUSES).toEqual([
      "pending",
      "dispatched",
      "succeeded",
      "failed",
      "cancelled",
      "parked:rate_limit",
    ]);
  });

  for (const status of WORK_UNIT_ATTEMPT_STATUSES) {
    it(`round-trips a work_unit_transition entry with status "${status}"`, () => {
      const entry = buildSampleEntry("work_unit_transition", { status });
      const line = encodeEntryToLine(entry);
      const decoded = decodeLine(line.slice(0, -1));
      expect(decoded).toEqual(entry);
      if (decoded.type !== "work_unit_transition") throw new Error("unreachable");
      expect(decoded.payload.status).toBe(status);
    });
  }

  it("a parked:rate_limit entry retains its sessionId in the round-tripped payload", () => {
    const entry = buildSampleEntry("work_unit_transition", {
      status: "parked:rate_limit",
      previousStatus: "dispatched",
      sessionId: SAMPLE_ID,
    });
    const decoded = decodeLine(encodeEntryToLine(entry).slice(0, -1));
    if (decoded.type !== "work_unit_transition") throw new Error("unreachable");
    expect(decoded.payload.status).toBe("parked:rate_limit");
    expect(decoded.payload.sessionId).toBe(SAMPLE_ID);
  });
});
