import { mkdtemp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, recordHeadAnchor, type JournalStore } from "@crabgic/journal";
import { createJournalHeadAnchorCheck } from "./journal-head-anchor.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

let dir: string;
let journalDir: string;
let anchorPath: string;
let journal: JournalStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eo-doctor-head-anchor-"));
  journalDir = join(dir, "journal");
  anchorPath = join(dir, "journal-head.anchor.json");
  journal = createJournalStore({ journalDir });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seed(store: JournalStore, to: string): Promise<void> {
  await store.appendEntry({
    type: "run_transition",
    runId: RUN_ID,
    payload: { from: "draft", to },
  } as never);
}

describe("journal.head-anchor doctor check", () => {
  it("passes, and says so plainly, when nothing has been anchored yet", async () => {
    const finding = await createJournalHeadAnchorCheck({ journal, anchorPath }).run();
    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("no journal head anchor recorded yet");
  });

  it("passes when the anchored entry is still present", async () => {
    await seed(journal, "awaiting_approval");
    await recordHeadAnchor(journal, anchorPath);
    await seed(journal, "ready");

    const finding = await createJournalHeadAnchorCheck({ journal, anchorPath }).run();
    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("holds");
  });

  it("FAILS on a rewritten history that verifyJournal() would call clean", async () => {
    await seed(journal, "awaiting_approval");
    await recordHeadAnchor(journal, anchorPath);

    await rm(journalDir, { recursive: true, force: true });
    const rewritten = createJournalStore({ journalDir });
    await seed(rewritten, "cancelled");
    expect((await rewritten.verifyJournal()).valid).toBe(true);

    const finding = await createJournalHeadAnchorCheck({ journal: rewritten, anchorPath }).run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("anchor_hash_mismatch");
    expect(finding.repairStep).toContain("not auto-repairable");
  });

  it("FAILS loudly on an anchor it cannot trust, rather than skipping it", async () => {
    await seed(journal, "awaiting_approval");
    await recordHeadAnchor(journal, anchorPath);
    await chmod(anchorPath, 0o644);

    const finding = await createJournalHeadAnchorCheck({ journal, anchorPath }).run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("could not be read");
  });
});
