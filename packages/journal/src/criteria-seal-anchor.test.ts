import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "./index.js";
import { findLatestCriteriaSeal, journalCriteriaSeal } from "./criteria-seal-anchor.js";

const CHANGE_SET_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CHANGE_SET_ID = "33333333-3333-4333-8333-333333333333";
const REQUIREMENT_ID = "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

let dir: string;
let journal: JournalStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "criteria-seal-anchor-"));
  journal = createJournalStore({ journalDir: join(dir, "journal") });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("journalCriteriaSeal / findLatestCriteriaSeal", () => {
  it("round-trips a seal for its own change set", async () => {
    await journalCriteriaSeal(journal, {
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { [REQUIREMENT_ID]: HASH_A },
    });

    const seal = await findLatestCriteriaSeal(journal, CHANGE_SET_ID);
    expect(seal?.criteriaHashes[REQUIREMENT_ID]).toBe(HASH_A);
  });

  it("returns undefined when no seal was ever recorded — the fail-closed input", async () => {
    expect(await findLatestCriteriaSeal(journal, CHANGE_SET_ID)).toBeUndefined();
  });

  it("never returns another change set's seal", async () => {
    await journalCriteriaSeal(journal, {
      changeSetId: OTHER_CHANGE_SET_ID,
      criteriaHashes: { [REQUIREMENT_ID]: HASH_A },
    });

    expect(await findLatestCriteriaSeal(journal, CHANGE_SET_ID)).toBeUndefined();
  });

  /**
   * LATEST wins, and this is the whole reason the lookup is not "first
   * writer wins" like the perf budget anchor: a material amendment demotes a
   * ChangeSet and it is approved again with new criteria. First-writer-wins
   * would make that legitimate re-approval look like tamper forever, and —
   * worse — would let a rollback to the ORIGINAL, superseded criteria pass.
   */
  it("returns the LATEST seal, so re-approval supersedes and rollback does not pass", async () => {
    await journalCriteriaSeal(journal, {
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { [REQUIREMENT_ID]: HASH_A },
    });
    await journalCriteriaSeal(journal, {
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { [REQUIREMENT_ID]: HASH_B },
    });

    const seal = await findLatestCriteriaSeal(journal, CHANGE_SET_ID);
    expect(seal?.criteriaHashes[REQUIREMENT_ID]).toBe(HASH_B);
  });

  it("ignores adjudication_decision entries that carry no seal at all", async () => {
    await journal.appendEntry({
      type: "adjudication_decision",
      changeSetId: CHANGE_SET_ID,
      payload: {
        decision: "policy_contained",
        rationale: "an ordinary adjudication entry, no seal",
        subjectId: CHANGE_SET_ID,
      },
    });

    expect(await findLatestCriteriaSeal(journal, CHANGE_SET_ID)).toBeUndefined();
  });

  it("a sealed entry is an ordinary journal entry — the chain still verifies", async () => {
    await journalCriteriaSeal(journal, {
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { [REQUIREMENT_ID]: HASH_A },
    });

    const report = await journal.verifyJournal();
    expect(report.valid).toBe(true);
    expect(report.firstInvalid).toBeUndefined();
  });
});
