/**
 * roadmap/09-cli-and-doctor.md work item 7 / exit criterion `evidence.query.test`:
 * "querying a fresh ChangeSet fixture with zero records returns an
 * empty-but-valid report, not an error"; "returns every journaled
 * EvidenceRecord for that ChangeSet."
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { buildEvidenceRecord } from "@eo/testkit";
import { queryEvidence } from "./query.js";

let root: string;
let journal: JournalStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-cli-evidence-"));
  journal = createJournalStore({ journalDir: join(root, "journal") });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("queryEvidence", () => {
  it("returns an empty-but-valid report for a fresh ChangeSet with zero records", async () => {
    const report = await queryEvidence({
      journal,
      changeSetId: "11111111-1111-4111-8111-111111111111",
    });
    expect(report).toEqual({ changeSetId: "11111111-1111-4111-8111-111111111111", records: [] });
  });

  it("returns every journaled EvidenceRecord for that ChangeSet, and none for a different one", async () => {
    const changeSetId = "11111111-1111-4111-8111-111111111111";
    const otherChangeSetId = "22222222-2222-4222-8222-222222222222";
    const record = buildEvidenceRecord({ changeSetId });
    const otherRecord = buildEvidenceRecord({ changeSetId: otherChangeSetId });

    await journal.appendEntry({ type: "evidence_pointer", changeSetId, payload: record });
    await journal.appendEntry({
      type: "evidence_pointer",
      changeSetId: otherChangeSetId,
      payload: otherRecord,
    });

    const report = await queryEvidence({ journal, changeSetId });
    expect(report.records).toEqual([record]);
  });

  it("ignores a non-evidence_pointer entry even if a permissive journal fake yielded one under the same filter", async () => {
    const changeSetId = "11111111-1111-4111-8111-111111111111";
    const permissiveJournal = {
      queryEntries: async function* () {
        yield {
          type: "run_transition" as const,
          payload: { from: "draft" as const, to: "cancelled" as const },
        };
      },
    };
    const report = await queryEvidence({ journal: permissiveJournal as never, changeSetId });
    expect(report.records).toEqual([]);
  });

  it("returns multiple EvidenceRecords for the same ChangeSet, in journal order", async () => {
    const changeSetId = "11111111-1111-4111-8111-111111111111";
    const first = buildEvidenceRecord({ changeSetId, command: "npm test" });
    const second = buildEvidenceRecord({ changeSetId, command: "npm run lint" });

    await journal.appendEntry({ type: "evidence_pointer", changeSetId, payload: first });
    await journal.appendEntry({ type: "evidence_pointer", changeSetId, payload: second });

    const report = await queryEvidence({ journal, changeSetId });
    expect(report.records.map((r) => r.command)).toEqual(["npm test", "npm run lint"]);
  });
});
