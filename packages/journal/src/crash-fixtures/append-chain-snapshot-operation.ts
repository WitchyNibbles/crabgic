import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { FIRST_SEQ } from "../codec/journal-entry.js";
import { signalFaultPoint } from "../kill-harness.js";
import { appendEntry } from "../store/append-entry.js";
import { createNodeFsPort } from "../store/fs-port.js";
import { segmentPath } from "../store/segment-layout.js";
import { writeSnapshot } from "../store/snapshot-io.js";
import { resolveStoreConfig, type JournalStoreConfig } from "../store/store-config.js";
import {
  APPEND_STEP_POINT_NAMES,
  createSignalingFsPort,
  SNAPSHOT_STEP_POINT_NAMES,
} from "./signaling-fs-port.js";

/**
 * The crash-suite child process (roadmap/04-journal-idempotency-leases.md
 * exit criterion: "1k randomized kill-iteration run (`runKillHarness` over
 * the append/chain/snapshot path)"). Spawned fresh once per fault point by
 * `runKillHarness`; performs `entryCountBefore` ordinary (unsignaled, real)
 * appends through the REAL store to establish prior state, then performs
 * exactly ONE "armed" operation (`mode`) with every real internal
 * write/fsync/close/rename step signaled via `createSignalingFsPort` — the
 * harness kills this process the instant it observes whichever single step
 * name it was told to watch for (`ctx.faultPoint`), so across many fault
 * points every possible kill timing within the real append/snapshot path is
 * exercised, using genuine `SIGKILL` on a genuine child process, never a
 * simulated corruption.
 *
 * `EO_CRASH_FIXTURE_BROKEN=1` switches the "append" mode's armed operation
 * to a deliberately UNSAFE write (open with truncate, no fsync, rewrites
 * the WHOLE segment file — including previously-valid prior entries — in
 * two unsynced halves) instead of the real `appendEntry`. This exists
 * solely to capture this deliverable's failing-first evidence (work item
 * 7's own precedent: "the harness is run against work items 2-5 and must
 * catch at least one seeded corruption class before it is trusted") — see
 * docs/evidence/phase-04/exit-criteria-crash-suite-red.txt.
 *
 * argv: [journalDir, entryCountBeforeStr, mode ("append"|"snapshot"), sleepMsStr]
 */

export const RUN_ID = "44444444-4444-4444-8444-444444444444";
export const CHANGE_SET_ID = "55555555-5555-4555-8555-555555555555";
export const SNAPSHOT_ID = "66666666-6666-4666-8666-666666666666";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every function below is exported so `append-chain-snapshot-operation.
 * test.ts` can exercise the REAL logic in-process (direct v8 coverage,
 * fast, no spawn) — separate from `crash-suite.test.ts`'s genuine
 * spawn+SIGKILL exercise of the SAME functions as this file's own CLI
 * entry point (`main()`, gated behind the `import.meta.url` check at the
 * bottom, mirroring `../lease-fixtures/lease-acquire-attempt.ts`'s
 * identical dual-mode pattern). The in-process tests cannot exercise the
 * genuine-kill-timing behavior itself (that requires a real process to
 * SIGKILL) — that remains `crash-suite.test.ts`'s job.
 */
export async function appendPriorEntries(config: JournalStoreConfig, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: `prior-${String(i)}` },
      runId: RUN_ID,
    });
  }
}

/** Deliberately unsafe: truncate-open + two unsynced half-writes, corrupting the WHOLE segment (not just its tail). See file-level doc comment. */
export async function brokenArmedAppend(
  config: JournalStoreConfig,
  sleepMs: number,
): Promise<void> {
  const path = segmentPath(config.segmentsDir, FIRST_SEQ);
  const priorContent = readFileSync(path, "utf8");
  const fakeLine = `${JSON.stringify({ broken: true, filler: "x".repeat(96) })}\n`;
  const newContent = priorContent + fakeLine;
  const half = Math.floor(newContent.length / 2);

  const fd = openSync(path, "w"); // TRUNCATES — destroys prior valid bytes immediately, unlike the real "a" (append) mode.
  signalFaultPoint(APPEND_STEP_POINT_NAMES[0]!); // "after-open-file"
  await sleep(sleepMs);

  writeSync(fd, newContent.slice(0, half));
  signalFaultPoint(APPEND_STEP_POINT_NAMES[1]!); // "after-write"
  await sleep(sleepMs);

  writeSync(fd, newContent.slice(half));
  closeSync(fd);
}

export async function armedAppend(config: JournalStoreConfig, sleepMs: number): Promise<void> {
  signalFaultPoint("before-append");
  if (process.env["EO_CRASH_FIXTURE_BROKEN"] === "1") {
    await brokenArmedAppend(config, sleepMs);
    return;
  }
  const wrapped: JournalStoreConfig = {
    ...config,
    fs: createSignalingFsPort(createNodeFsPort(), APPEND_STEP_POINT_NAMES, sleepMs),
  };
  await appendEntry(wrapped, {
    type: "fanout_rationale",
    payload: { rationale: "armed-entry" },
    runId: RUN_ID,
  });
}

export async function armedSnapshot(
  config: JournalStoreConfig,
  entryCountBefore: number,
  sleepMs: number,
): Promise<void> {
  signalFaultPoint("before-snapshot");
  const wrapped: JournalStoreConfig = {
    ...config,
    fs: createSignalingFsPort(createNodeFsPort(), SNAPSHOT_STEP_POINT_NAMES, sleepMs),
  };
  await writeSnapshot(wrapped, {
    schemaVersion: 1,
    id: SNAPSHOT_ID,
    runId: RUN_ID,
    changeSetId: CHANGE_SET_ID,
    runState: "running",
    journalSequenceNumber: entryCountBefore,
    capturedAt: new Date().toISOString(),
  });
}

/**
 * VALIDATION ROUND (2026-07-18) fix, MAJOR 1: `EO_CRASH_FIXTURE_SEGMENT_MAX_BYTES`
 * (optional env var, unset by default — preserving the original
 * never-rotates behavior for the existing crash-suite variant) lets
 * `crash-suite.test.ts`'s new "segment rotation variant" describe block
 * spawn this same fixture with a small segment size threshold, forcing
 * `appendPriorEntries`/`armedAppend` to rotate across multiple real
 * segment files — exercising the genuinely multi-segment kill-timing path
 * the original (single-segment) crash suite never covered (the exact gap
 * the validation round's MAJOR 1 finding named: "The 1000-iteration crash
 * suite NEVER rotates segments... green was vacuous for rotated
 * journals").
 */
function resolveSegmentMaxBytesFromEnv(): number | undefined {
  const raw = process.env["EO_CRASH_FIXTURE_SEGMENT_MAX_BYTES"];
  return raw === undefined ? undefined : Number(raw);
}

export async function main(): Promise<void> {
  const [, , journalDir, entryCountBeforeStr, mode, sleepMsStr] = process.argv;
  if (journalDir === undefined || entryCountBeforeStr === undefined || mode === undefined) {
    process.stderr.write("append-chain-snapshot-operation: missing required argv\n");
    process.exit(2);
  }
  const entryCountBefore = Number(entryCountBeforeStr);
  const sleepMs = Number(sleepMsStr ?? "10");

  const segmentMaxBytes = resolveSegmentMaxBytesFromEnv();
  const config = resolveStoreConfig({
    journalDir,
    fs: createNodeFsPort(),
    ...(segmentMaxBytes !== undefined ? { segmentMaxBytes } : {}),
  });
  await appendPriorEntries(config, entryCountBefore);

  if (mode === "append") {
    await armedAppend(config, sleepMs);
  } else if (mode === "snapshot") {
    await armedSnapshot(config, entryCountBefore, sleepMs);
  } else {
    process.stderr.write(`append-chain-snapshot-operation: unknown mode "${mode}"\n`);
    process.exit(2);
  }
  process.exit(0);
}

// Entry point: only reached when this file is the process's own CLI entry
// (i.e. spawned directly by runKillHarness/prepareCrashSuiteRuntime),
// never when its exported functions are imported in-process by
// append-chain-snapshot-operation.test.ts — mirrors
// ../lease-fixtures/lease-acquire-attempt.ts's identical pattern.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
