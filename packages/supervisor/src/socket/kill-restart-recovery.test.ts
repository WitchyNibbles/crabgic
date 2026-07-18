/**
 * roadmap/05-supervisor-daemon.md §Test plan, Integration: "kill -9
 * mid-operation → restart → registries recovered via 04's recover(runId)
 * with no duplicated side effect (reuse 04's runKillHarness)." Exit
 * criterion: "kill -9 mid-operation → restart recovers registries via 04's
 * recover(runId); no duplicated side effects."
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, runKillHarness, type JournalStore } from "@eo/journal";
import { recoverRun } from "../registries/recovery.js";
import { createRunsRegistry } from "../registries/runs-registry.js";
import { createWorkersRegistry } from "../registries/workers-registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "kill-harness-fixtures", "append-transitions-and-crash.mjs");

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";

let journalDir: string;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-supervisor-kill-recovery-"));
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function fixtureSpec() {
  return {
    command: process.execPath,
    args: [FIXTURE],
    env: {
      EO_KILL_HARNESS_JOURNAL_DIR: journalDir,
      EO_KILL_HARNESS_RUN_ID: RUN_ID,
      EO_KILL_HARNESS_CHANGE_SET_ID: CHANGE_SET_ID,
      EO_KILL_HARNESS_FAULT_POINT: "before-second-transition",
    },
  };
}

async function verifyRecoveryConverges(): Promise<{ recovered: boolean; detail: string }> {
  // "restart": a brand-new JournalStore + brand-new (empty, in-memory)
  // registries over the SAME on-disk journal dir the killed child wrote
  // to — exactly what a real supervisor restart looks like.
  const store: JournalStore = createJournalStore({ journalDir });
  const runs = createRunsRegistry();
  const workers = createWorkersRegistry();

  try {
    await recoverRun(RUN_ID, { journal: store, runs, workers });
  } catch (err) {
    return { recovered: false, detail: `recoverRun threw: ${String(err)}` };
  }

  // No duplicated side effect: every run_transition entry for this run
  // forms a valid, non-duplicated chain — no two entries carry the
  // identical (from, to) pair, and each has a strictly increasing,
  // unique seq (append-only journal invariant, already proven by 04's own
  // suite; re-asserted here as this phase's own consumer-side check).
  const entries: { seq: number; payload: { from: string; to: string } }[] = [];
  for await (const entry of store.queryEntries({ type: "run_transition", runId: RUN_ID })) {
    entries.push(entry as unknown as { seq: number; payload: { from: string; to: string } });
  }
  const seqs = entries.map((e) => e.seq);
  const uniqueSeqs = new Set(seqs);
  const pairs = entries.map((e) => `${e.payload.from}->${e.payload.to}`);
  const uniquePairs = new Set(pairs);

  const noDuplicateSeq = uniqueSeqs.size === seqs.length;
  const noDuplicatePair = uniquePairs.size === pairs.length;
  const chainValid = entries.length <= 2; // this fixture writes at most 2 transitions

  const recovered = noDuplicateSeq && noDuplicatePair && chainValid;
  return {
    recovered,
    detail: `entries=${JSON.stringify(pairs)} seqs=${JSON.stringify(seqs)} runState=${runs.get(RUN_ID)?.runState ?? "(none)"}`,
  };
}

describe("kill -9 mid-operation -> restart -> recover(runId), reusing 04's runKillHarness", () => {
  it("recovers cleanly with no duplicated journal entries after a kill mid-transition", async () => {
    const report = await runKillHarness(fixtureSpec(), ["before-second-transition"], {
      verify: verifyRecoveryConverges,
    });

    expect(report.results).toHaveLength(1);
    const result = report.results[0];
    expect(result?.killedAt).toBe("marker-observed");
    expect(result?.recovered).toBe(true);
    expect(result?.verdict).toBe("pass");
  }, 30_000);
});
