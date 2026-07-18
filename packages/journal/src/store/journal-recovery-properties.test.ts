/**
 * Property tests (fast-check) — roadmap/04-journal-idempotency-leases.md
 * §Test plan, Property bullet: "randomized torn-write injection always
 * recovers to a valid chain prefix"; "snapshot+replay reconstructs state
 * identical to a full replay-from-genesis across randomized snapshot
 * points." Real filesystem (mkdtempSync), per this phase's own Integration
 * test-plan bullet ("real filesystem in tmp dirs — real fsync, not
 * mocked") — `numRuns` is kept modest (real fs I/O per run) rather than
 * fast-check's default, documented per-property below.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_LIFECYCLE_TRANSITIONS, type RunLifecycleState } from "@eo/contracts";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { FIRST_SEQ } from "../codec/journal-entry.js";
import type { JournalEntry } from "../codec/journal-entry.js";
import { appendEntry } from "./append-entry.js";
import { repairChain } from "./repair-chain.js";
import { queryEntries } from "./query-entries.js";
import { segmentPath } from "./segment-layout.js";
import { recover, writeSnapshot } from "./snapshot-io.js";
import { resolveStoreConfig, type JournalStoreConfig } from "./store-config.js";
import { verifyChain } from "./verify-chain.js";

const dirsToClean: string[] = [];

function freshConfig(): JournalStoreConfig {
  const journalDir = mkdtempSync(join(tmpdir(), "eo-journal-prop-"));
  dirsToClean.push(journalDir);
  return resolveStoreConfig({ journalDir });
}

afterEach(() => {
  while (dirsToClean.length > 0) {
    rmSync(dirsToClean.pop()!, { recursive: true, force: true });
  }
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

/** Reduces a sequence of run_transition entries to a final RunLifecycleState, folding in seq order from `initial`. */
function reduceRunState(
  entries: readonly JournalEntry[],
  initial: RunLifecycleState,
): RunLifecycleState {
  let state = initial;
  for (const entry of entries) {
    if (entry.type === "run_transition") state = entry.payload.to;
  }
  return state;
}

/** A random legal walk through the run-lifecycle transition table, starting at "draft", `steps` transitions long (stopping early if an absorbing state is reached). */
function randomLegalWalk(
  steps: number,
  pick: (max: number) => number,
): readonly RunLifecycleState[] {
  const path: RunLifecycleState[] = ["draft"];
  let current: RunLifecycleState = "draft";
  for (let i = 0; i < steps; i++) {
    const options: readonly RunLifecycleState[] = RUN_LIFECYCLE_TRANSITIONS[current];
    if (options.length === 0) break;
    const next: RunLifecycleState = options[pick(options.length)]!;
    path.push(next);
    current = next;
  }
  return path;
}

describe("property: randomized torn-write injection always recovers to a valid chain prefix", () => {
  it("recovers to a valid chain prefix across randomized entry counts and cut points", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }), // entries before the torn one
        fc.integer({ min: 1, max: 1000 }), // seed for how deep into the last line's bytes to cut
        async (entryCount, cutSeed) => {
          const config = freshConfig();
          const entries: JournalEntry[] = [];
          for (let i = 0; i < entryCount; i++) {
            const entry = await appendEntry(config, {
              type: "fanout_rationale",
              payload: { rationale: `entry-${i}` },
            });
            entries.push(entry);
          }
          // One more entry that will be the torn one.

          await appendEntry(config, {
            type: "fanout_rationale",
            payload: { rationale: "torn-entry" },
          });

          const path = segmentPath(config.segmentsDir, FIRST_SEQ);
          const full = readFileSync(path, "utf8");
          const lastNewline = full.lastIndexOf("\n", full.length - 2);
          const lastLineLength = full.length - (lastNewline + 1);
          // `lastLineLength` includes the last line's trailing "\n" byte
          // (i.e. lastLineLength = jsonContentLength + 1). `cutInto` must
          // land strictly WITHIN the JSON content, never at
          // `jsonContentLength` itself — that boundary would strip only the
          // trailing newline, leaving the JSON content fully intact and
          // parseable (a harmless, non-corrupting edit `verifyChain`
          // correctly reports as no issue) rather than a genuine torn
          // write. INTEGRATION FIX (documented, see docs/evidence/
          // phase-04/README.md's Deviations): the prior range,
          // `Math.max(1, lastLineLength - 1)`, could reach exactly that
          // boundary — caught as a rare fast-check counterexample
          // (entryCount=2, cutSeed=561) during this worker's full-package
          // gate run, where `beforeRepair.firstIssue` was unexpectedly
          // `undefined`. Capping the modulus at `lastLineLength - 2`
          // (i.e. `jsonContentLength - 1`) excludes that boundary.
          const cutInto = 1 + (cutSeed % Math.max(1, lastLineLength - 2));
          writeFileSync(path, full.slice(0, lastNewline + 1 + cutInto));

          const beforeRepair = await verifyChain(config.fs, path);
          expect(beforeRepair.firstIssue).toBeDefined();
          expect(beforeRepair.validEntries).toEqual(entries);

          await repairChain(config, path);

          // ALWAYS recovers to a valid chain prefix: no issue, and every
          // originally-intact entry survives (plus the repair entry).
          const afterRepair = await verifyChain(config.fs, path);
          expect(afterRepair.firstIssue).toBeUndefined();
          expect(afterRepair.validEntries.slice(0, entries.length)).toEqual(entries);
          expect(afterRepair.validEntries).toHaveLength(entries.length + 1);
          expect(afterRepair.validEntries[afterRepair.validEntries.length - 1]!.type).toBe(
            "adjudication_decision",
          );
        },
      ),
      { numRuns: 15 },
    );
  });
});

describe("property: snapshot+replay reconstructs identical state to full replay-from-genesis", () => {
  it("recovered state matches full replay-from-genesis across randomized walks and snapshot points", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }), // walk length
        fc.integer({ min: 0, max: 5 }), // which step to snapshot after (clamped to the actual walk length below)
        fc.integer({ min: 0, max: 1_000_000 }), // deterministic "random" pick seed
        async (steps, snapshotAfterStepRaw, pickSeed) => {
          const runId = "11111111-1111-4111-8111-111111111111";
          const config = freshConfig();

          let pickState = pickSeed;
          const pick = (max: number): number => {
            pickState = (pickState * 1103515245 + 12345) >>> 0;
            return pickState % max;
          };
          const walk = randomLegalWalk(steps, pick);
          const snapshotAfterStep = Math.min(snapshotAfterStepRaw, Math.max(0, walk.length - 2));

          const appended: JournalEntry[] = [];
          for (let i = 1; i < walk.length; i++) {
            const from = walk[i - 1]!;
            const to = walk[i]!;

            const entry = await appendEntry(config, {
              type: "run_transition",
              payload: { from, to },
              runId,
            });
            appended.push(entry);

            if (i - 1 === snapshotAfterStep) {
              await writeSnapshot(config, {
                schemaVersion: 1,
                id: "22222222-2222-4222-8222-222222222222",
                runId,
                changeSetId: "33333333-3333-4333-8333-333333333333",
                runState: to,
                journalSequenceNumber: entry.seq,
                capturedAt: "2026-01-01T00:00:00.000Z",
              });
            }
          }

          const fullReplayEntries = await collect(
            queryEntries(config, { runId, type: "run_transition" }),
          );
          const fullReplayState = reduceRunState(fullReplayEntries, "draft");

          const recovered = await recover(config, runId);
          const baseState: RunLifecycleState = recovered.snapshot?.runState ?? "draft";
          const recoveredState = reduceRunState(recovered.replayed, baseState);

          expect(recoveredState).toBe(fullReplayState);

          // The replayed set is exactly "entries with seq > snapshot's seq" —
          // never more, never fewer, never out of order.
          const floor = recovered.snapshot?.journalSequenceNumber ?? 0;
          const expectedReplayed = fullReplayEntries.filter((e) => e.seq > floor);
          expect(recovered.replayed).toEqual(expectedReplayed);
        },
      ),
      { numRuns: 20 },
    );
  });
});
