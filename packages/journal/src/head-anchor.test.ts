import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "./index.js";
import {
  readJournalHead,
  recordHeadAnchor,
  readHeadAnchor,
  verifyAgainstHeadAnchor,
} from "./head-anchor.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

let dir: string;
let journalDir: string;
let anchorPath: string;
let journal: JournalStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eo-head-anchor-"));
  journalDir = join(dir, "journal");
  anchorPath = join(dir, "journal-head.anchor.json");
  journal = createJournalStore({ journalDir });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function appendRunTransition(from: string, to: string): Promise<void> {
  await journal.appendEntry({
    type: "run_transition",
    runId: RUN_ID,
    payload: { from, to },
  } as never);
}

async function seedThreeEntries(): Promise<void> {
  await appendRunTransition("draft", "awaiting_approval");
  await appendRunTransition("awaiting_approval", "ready");
  await appendRunTransition("ready", "running");
}

describe("readJournalHead", () => {
  it("is undefined for an empty journal", async () => {
    expect(await readJournalHead(journal)).toBeUndefined();
  });

  it("reports the last entry's seq and hash", async () => {
    await seedThreeEntries();
    const head = await readJournalHead(journal);
    expect(head?.seq).toBe(3);
    expect(head?.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("recordHeadAnchor / readHeadAnchor", () => {
  it("round-trips, and writes owner-only", async () => {
    await seedThreeEntries();
    const written = await recordHeadAnchor(journal, anchorPath, { now: () => new Date(0) });
    expect(written?.seq).toBe(3);

    const read = await readHeadAnchor(anchorPath);
    expect(read).toStrictEqual(written);
    expect(read?.recordedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("records nothing for an empty journal — there is no head to pin", async () => {
    expect(await recordHeadAnchor(journal, anchorPath, { now: () => new Date(0) })).toBeUndefined();
    expect(await readHeadAnchor(anchorPath)).toBeUndefined();
  });

  it("refuses an anchor file that is group- or world-readable", async () => {
    await seedThreeEntries();
    await recordHeadAnchor(journal, anchorPath, { now: () => new Date(0) });
    const { chmod } = await import("node:fs/promises");
    await chmod(anchorPath, 0o644);
    await expect(readHeadAnchor(anchorPath)).rejects.toThrow(/group-or-world-accessible/);
  });
});

describe("verifyAgainstHeadAnchor — what verifyJournal() cannot see", () => {
  it("passes when the journal still contains the anchored entry", async () => {
    await seedThreeEntries();
    const anchor = await recordHeadAnchor(journal, anchorPath, { now: () => new Date(0) });
    await appendRunTransition("running", "verifying");

    const verdict = await verifyAgainstHeadAnchor(journal, anchor!);
    expect(verdict.ok).toBe(true);
  });

  it("passes for an anchor taken at the current head, with nothing appended since", async () => {
    await seedThreeEntries();
    const anchor = await recordHeadAnchor(journal, anchorPath, { now: () => new Date(0) });
    expect((await verifyAgainstHeadAnchor(journal, anchor!)).ok).toBe(true);
  });

  /**
   * THE WHOLE POINT. The chain is a plain SHA-256 with no secret, so anyone
   * who can write the segment files can rewrite history from genesis and
   * produce a journal that is internally consistent — `verifyJournal()`
   * reports it clean, because every link recomputes correctly. Only a record
   * of what the head USED to be can catch that.
   */
  it("CATCHES a wholesale rewrite that verifyJournal() reports as clean", async () => {
    await seedThreeEntries();
    const anchor = await recordHeadAnchor(journal, anchorPath, { now: () => new Date(0) });

    // Rewrite history: a brand-new journal in the same place, with different
    // content, re-chained from genesis.
    await rm(journalDir, { recursive: true, force: true });
    const rewritten = createJournalStore({ journalDir });
    await rewritten.appendEntry({
      type: "run_transition",
      runId: RUN_ID,
      payload: { from: "draft", to: "awaiting_approval" },
    } as never);
    await rewritten.appendEntry({
      type: "run_transition",
      runId: RUN_ID,
      payload: { from: "awaiting_approval", to: "cancelled" },
    } as never);
    await rewritten.appendEntry({
      type: "run_transition",
      runId: RUN_ID,
      payload: { from: "cancelled", to: "cancelled" },
    } as never);

    // The forged chain is internally perfect.
    const report = await rewritten.verifyJournal();
    expect(report.valid).toBe(true);
    expect(report.firstInvalid).toBeUndefined();

    // The anchor is not fooled.
    const verdict = await verifyAgainstHeadAnchor(rewritten, anchor!);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("anchor_hash_mismatch");
    expect(verdict.anchoredHash).toBe(anchor!.hash);
  });

  it("CATCHES truncation — the anchored seq no longer exists", async () => {
    await seedThreeEntries();
    const anchor = await recordHeadAnchor(journal, anchorPath, { now: () => new Date(0) });

    await rm(journalDir, { recursive: true, force: true });
    const truncated = createJournalStore({ journalDir });
    await truncated.appendEntry({
      type: "run_transition",
      runId: RUN_ID,
      payload: { from: "draft", to: "awaiting_approval" },
    } as never);

    const verdict = await verifyAgainstHeadAnchor(truncated, anchor!);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("head_behind_anchor");
  });

  it("CATCHES an emptied journal", async () => {
    await seedThreeEntries();
    const anchor = await recordHeadAnchor(journal, anchorPath, { now: () => new Date(0) });
    await rm(journalDir, { recursive: true, force: true });

    const verdict = await verifyAgainstHeadAnchor(createJournalStore({ journalDir }), anchor!);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("head_behind_anchor");
  });

  it("a corrupted anchor file is a loud refusal, never a silent pass", async () => {
    await seedThreeEntries();
    await recordHeadAnchor(journal, anchorPath, { now: () => new Date(0) });
    const raw = await readFile(anchorPath, "utf8");
    await writeFile(anchorPath, raw.replace(/"seq":\s*\d+/, '"seq": "three"'), { mode: 0o600 });

    await expect(readHeadAnchor(anchorPath)).rejects.toThrow();
  });
});
