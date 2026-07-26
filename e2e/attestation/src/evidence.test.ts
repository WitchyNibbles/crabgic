import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EvidenceRecordSchema } from "@crabgic/contracts";
import type { JournalEntryInput } from "@crabgic/journal";
import { buildCheckResult } from "./checkResult.js";
import {
  ATTESTATION_GATE_TAGS,
  FAKE_RELEASE_CANDIDATE_OBJECT_ID,
  emitAttestationEvidence,
  resolveReleaseCandidateObjectId,
  SECURITY_REVIEW_GATE_TAG,
} from "./evidence.js";

/** `EvidenceRecord.changeSetId` is `IdSchema` — a real UUID, not a readable slug. */
const CHANGE_SET_ID = "11111111-2222-4333-8444-555555555555";

/** Captures what would have been journaled, without needing a real store. */
function recordingJournal(): {
  readonly appendEntry: (entry: JournalEntryInput) => Promise<void>;
  readonly entries: JournalEntryInput[];
} {
  const entries: JournalEntryInput[] = [];
  return {
    entries,
    appendEntry: (entry) => {
      entries.push(entry);
      return Promise.resolve();
    },
  };
}

describe("emitAttestationEvidence", () => {
  it("journals a schema-valid EvidenceRecord as an evidence_pointer entry", async () => {
    const journal = recordingJournal();
    const record = await emitAttestationEvidence({
      journal,
      changeSetId: CHANGE_SET_ID,
      gateTag: SECURITY_REVIEW_GATE_TAG,
      command: "attestation:security-review",
      result: buildCheckResult([], ["sign-off present"]),
      objectId: FAKE_RELEASE_CANDIDATE_OBJECT_ID,
      capturedAt: () => "2026-07-25T00:00:00.000Z",
    });

    expect(() => EvidenceRecordSchema.parse(record)).not.toThrow();
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0]?.type).toBe("evidence_pointer");
    expect(journal.entries[0]?.payload).toEqual(record);
    expect(record.gateTag).toBe(SECURITY_REVIEW_GATE_TAG);
  });

  it("derives exitStatus 0 from a PASS", async () => {
    const journal = recordingJournal();
    const record = await emitAttestationEvidence({
      journal,
      changeSetId: CHANGE_SET_ID,
      gateTag: SECURITY_REVIEW_GATE_TAG,
      command: "attestation:security-review",
      result: buildCheckResult([]),
    });
    expect(record.exitStatus).toBe(0);
  });

  /**
   * The load-bearing anti-fabrication test: a FAILing check must land as a
   * genuine non-zero exit status. `e2e/report`'s generator scores an item
   * FAIL when any linked record is non-zero, so this assertion is the one
   * thing standing between "the check found a problem" and "the release
   * gate went green anyway".
   */
  it("derives a non-zero exitStatus from a FAIL — a failing check can never journal a green record", async () => {
    const journal = recordingJournal();
    const record = await emitAttestationEvidence({
      journal,
      changeSetId: CHANGE_SET_ID,
      gateTag: SECURITY_REVIEW_GATE_TAG,
      command: "attestation:security-review",
      result: buildCheckResult(["an unresolved CRITICAL finding is open"]),
    });
    expect(record.exitStatus).not.toBe(0);
  });

  it("digests the result rather than inlining its raw text", async () => {
    const journal = recordingJournal();
    const record = await emitAttestationEvidence({
      journal,
      changeSetId: CHANGE_SET_ID,
      gateTag: SECURITY_REVIEW_GATE_TAG,
      command: "attestation:security-review",
      result: buildCheckResult(["a secret-shaped reason"], ["a detail"]),
    });
    expect(record.artifactDigests).toHaveLength(2);
    for (const digest of record.artifactDigests) {
      expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(digest).not.toContain("secret-shaped");
    }
  });
});

describe("resolveReleaseCandidateObjectId", () => {
  const ENV = "CRABGIC_RELEASE_CANDIDATE_OBJECT_ID";
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[ENV];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  it("prefers the release-candidate env var when set", () => {
    process.env[ENV] = "abc123";
    expect(resolveReleaseCandidateObjectId()).toBe("abc123");
  });

  it("treats an empty value as unset", () => {
    process.env[ENV] = "";
    expect(resolveReleaseCandidateObjectId()).toBe(FAKE_RELEASE_CANDIDATE_OBJECT_ID);
  });

  it("falls back to the documented stand-in when unset", () => {
    delete process.env[ENV];
    expect(resolveReleaseCandidateObjectId()).toBe(FAKE_RELEASE_CANDIDATE_OBJECT_ID);
  });
});

describe("ATTESTATION_GATE_TAGS", () => {
  it("covers exactly the seven previously-unreported checklist items", () => {
    expect([...ATTESTATION_GATE_TAGS]).toEqual([
      "release-gate:security-review",
      "release-gate:requirement-traceability",
      "release-gate:performance-contracts",
      "release-gate:demo-branch-evidence-handoff",
      "release-gate:arm64-verification",
      "release-gate:jira-grafana-version-support-windows",
      "release-gate:release-docs-committed",
    ]);
    expect(new Set(ATTESTATION_GATE_TAGS).size).toBe(ATTESTATION_GATE_TAGS.length);
  });
});
