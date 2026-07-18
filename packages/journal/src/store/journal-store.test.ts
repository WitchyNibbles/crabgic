import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GENESIS_PREV_HASH } from "../codec/hash-chain.js";
import { FIRST_SEQ } from "../codec/journal-entry.js";
import { createJournalStore } from "./journal-store.js";
import { segmentPath } from "./segment-layout.js";
import { verifyChain } from "./verify-chain.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

let journalDir: string | undefined;

afterEach(() => {
  if (journalDir !== undefined) rmSync(journalDir, { recursive: true, force: true });
  journalDir = undefined;
});

function freshStore() {
  journalDir = mkdtempSync(join(tmpdir(), "eo-journal-store-"));
  return createJournalStore({ journalDir });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("createJournalStore — the full assembled surface", () => {
  it("appendEntry assigns the genesis chain fields on the first call", async () => {
    const store = freshStore();
    const entry = await store.appendEntry({
      type: "fanout_rationale",
      payload: { rationale: "hello" },
    });
    expect(entry.seq).toBe(FIRST_SEQ);
    expect(entry.prevHash).toBe(GENESIS_PREV_HASH);
  });

  it("queryEntries reads back what appendEntry wrote", async () => {
    const store = freshStore();
    await store.appendEntry({ type: "fanout_rationale", payload: { rationale: "a" } });
    await store.appendEntry({ type: "fanout_rationale", payload: { rationale: "b" } });
    const all = await collect(store.queryEntries());
    expect(all).toHaveLength(2);
  });

  it("verifyJournal reports a fully valid journal for what appendEntry wrote (API CHANGE: replaces the removed store.verifyChain(segmentFilePath) convenience method — see VALIDATION ROUND MAJOR 1 fix)", async () => {
    const store = freshStore();
    await store.appendEntry({ type: "fanout_rationale", payload: { rationale: "a" } });
    const report = await store.verifyJournal();
    expect(report.valid).toBe(true);
    expect(report.firstInvalid).toBeUndefined();
    expect(report.totalValidEntries).toBe(1);
  });

  it("repairJournal truncates a torn tail written directly to disk and re-chains a repair entry (API CHANGE: replaces the removed store.repairChain(segmentFilePath) convenience method — see VALIDATION ROUND MAJOR 1 fix)", async () => {
    const store = freshStore();
    const e1 = await store.appendEntry({
      type: "fanout_rationale",
      payload: { rationale: "kept" },
    });
    await store.appendEntry({ type: "fanout_rationale", payload: { rationale: "torn" } });
    const path = segmentPath(store.config.segmentsDir, FIRST_SEQ);
    const full = readFileSync(path, "utf8");
    const lastNewline = full.lastIndexOf("\n", full.length - 2);
    writeFileSync(path, full.slice(0, lastNewline + 1 + 3));

    const report = await store.repairJournal();
    expect(report.repaired).toBe(true);
    expect(report.segmentRepair?.truncatedToSeq).toBe(e1.seq);
    expect(report.verification.valid).toBe(true);
  });

  it("writeSnapshot / loadLatestSnapshot / recover round-trip through the store", async () => {
    const store = freshStore();
    const entry = await store.appendEntry({
      type: "run_transition",
      payload: { from: "draft", to: "awaiting_approval" },
      runId: RUN_ID,
    });
    await store.writeSnapshot({
      schemaVersion: 1,
      id: "22222222-2222-4222-8222-222222222222",
      runId: RUN_ID,
      changeSetId: "33333333-3333-4333-8333-333333333333",
      runState: "awaiting_approval",
      journalSequenceNumber: entry.seq,
      capturedAt: "2026-01-01T00:00:00.000Z",
    });

    const loaded = await store.loadLatestSnapshot(RUN_ID);
    expect(loaded?.journalSequenceNumber).toBe(entry.seq);

    const recovered = await store.recover(RUN_ID);
    expect(recovered.snapshot?.journalSequenceNumber).toBe(entry.seq);
    expect(recovered.replayed).toEqual([]);
  });

  it("gc never deletes a segment newer than the latest durable snapshot, via the store's bound method", async () => {
    const store = freshStore();
    const entry = await store.appendEntry({
      type: "fanout_rationale",
      payload: { rationale: "x" },
      runId: RUN_ID,
    });
    await store.writeSnapshot({
      schemaVersion: 1,
      id: "22222222-2222-4222-8222-222222222222",
      runId: RUN_ID,
      changeSetId: "33333333-3333-4333-8333-333333333333",
      runState: "running",
      journalSequenceNumber: entry.seq,
      capturedAt: "2026-01-01T00:00:00.000Z",
    });
    const report = await store.gc({ minSegmentsToKeep: 0 });
    expect(report.safeSeqFloor).toBe(entry.seq);
  });

  it("exposes config for advanced/test introspection", () => {
    const store = freshStore();
    expect(store.config.segmentsDir.endsWith("segments")).toBe(true);
    expect(store.config.snapshotsDir.endsWith("snapshots")).toBe(true);
  });
});

describe("VALIDATION ROUND (2026-07-18) — MAJOR 1 regression: repairing a rotated journal via the highest segment's path must not destroy committed entries", () => {
  /**
   * The adversarial validator's exact repro (phase-04 validation round,
   * MAJOR 1): a rotated journal with segments [1, 2, 3], one valid,
   * committed entry per segment. `store.repairChain(highestSegmentPath)`
   * on unfixed code defaults `expectedInitialPrevHash` to the journal
   * GENESIS constant — but segment 3's own first entry's `prevHash` is
   * segment 2's LAST hash, not genesis, so `verifyChain` misreports
   * `prev_hash_mismatch` at line 0 of a segment that is not actually
   * corrupted at all. `lastValidByteLength` is then `0`, so
   * `durablyTruncateFile` truncates the WHOLE committed segment 3 to zero
   * bytes, destroying the real, already-durable seq=3 entry; the repair
   * entry that gets appended afterward then starts a fresh chain at
   * seq=1 — a duplicate of segment 1's own seq=1, corrupting the
   * journal's global monotonic-seq invariant.
   *
   * Written first against UNFIXED `journal-store.ts`/`repair-chain.ts` —
   * see docs/evidence/phase-04/fix1-rotated-repair-failing.txt for the
   * captured RED run (this exact repro, before whole-journal
   * verify/repair orchestration existed; the RED capture used
   * `store.repairChain(highestSegmentPath)`, since `store.repairJournal()`
   * did not exist yet). After the fix, `repairChain` with a defaulted
   * genesis hash is no longer reachable through the store's own surface —
   * this same test was updated in place to call the new orchestrated
   * `store.repairJournal()` instead; see docs/evidence/phase-04/
   * fix1-rotated-repair-passing.txt.
   */
  it("the committed seq=3 entry survives repair, and no duplicate seq is ever produced", async () => {
    // segmentMaxBytes: 1 forces rotation after every single entry (see the
    // existing "rotates to a new segment once the size threshold is
    // crossed" coverage in append-entry.test.ts for the same technique).
    journalDir = mkdtempSync(join(tmpdir(), "eo-journal-store-rot-"));
    const store = createJournalStore({ journalDir, segmentMaxBytes: 1 });

    const e1 = await store.appendEntry({
      type: "fanout_rationale",
      payload: { rationale: "segment-1" },
    });
    const e2 = await store.appendEntry({
      type: "fanout_rationale",
      payload: { rationale: "segment-2" },
    });
    const e3 = await store.appendEntry({
      type: "fanout_rationale",
      payload: { rationale: "segment-3" },
    });
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e3.seq).toBe(3);

    const highestSegmentPath = segmentPath(store.config.segmentsDir, 3);

    // ACT (GREEN, post-fix): the safe, whole-journal-aware orchestrated
    // repair — the store no longer exposes a per-segment `repairChain`
    // convenience method reachable with a defaulted genesis hash at all.
    const repairReport = await store.repairJournal();

    // DESIRED (safe) OUTCOME: nothing was actually corrupted (the
    // prevHash chain IS valid once threaded across segment boundaries),
    // so repair must be a genuine no-op — segment 3's own committed entry
    // must survive untouched, and every seq across the whole journal must
    // stay globally unique and monotonic.
    expect(repairReport.repaired).toBe(false);
    expect(repairReport.verification.valid).toBe(true);

    const allEntries = await collect(store.queryEntries());
    expect(allEntries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(new Set(allEntries.map((e) => e.seq)).size).toBe(allEntries.length);

    const segment3Report = await verifyChain(store.config.fs, highestSegmentPath, e2.hash);
    expect(segment3Report.firstIssue).toBeUndefined();
    expect(segment3Report.validEntries).toEqual([e3]);
  });
});
