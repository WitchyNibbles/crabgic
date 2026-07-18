import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIRST_SEQ } from "../codec/journal-entry.js";
import { createNodeFsPort } from "../store/fs-port.js";
import { segmentPath } from "../store/segment-layout.js";
import { loadLatestSnapshot } from "../store/snapshot-io.js";
import { resolveStoreConfig } from "../store/store-config.js";
import { verifyChain } from "../store/verify-chain.js";
import {
  appendPriorEntries,
  armedAppend,
  armedSnapshot,
  brokenArmedAppend,
  RUN_ID,
} from "./append-chain-snapshot-operation.js";

/**
 * IN-PROCESS coverage for the crash-suite fixture's real logic (as opposed
 * to `crash-suite.test.ts`, which exercises the SAME exported functions
 * via a genuinely spawned + SIGKILLed child process — that file proves
 * real-kill-timing behavior; this file proves the functions' own logic is
 * correct in isolation, fast, with direct v8 coverage). Every
 * `signalFaultPoint` call writes a marker line to this process's own
 * stdout when run this way — spied and silenced below, matching
 * `kill-harness.test.ts`'s own "signalFaultPoint — unit" precedent.
 */

const dirsToClean: string[] = [];
let stdoutSpy: ReturnType<typeof vi.spyOn> | undefined;

afterEach(() => {
  while (dirsToClean.length > 0) {
    rmSync(dirsToClean.pop()!, { recursive: true, force: true });
  }
  stdoutSpy?.mockRestore();
  stdoutSpy = undefined;
  delete process.env["EO_CRASH_FIXTURE_BROKEN"];
});

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "eo-crash-fixture-inprocess-"));
  dirsToClean.push(dir);
  return dir;
}

function silenceStdout(): void {
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
}

describe("appendPriorEntries", () => {
  it("appends exactly `count` real fanout_rationale entries", async () => {
    const dir = freshDir();
    const config = resolveStoreConfig({ journalDir: dir, fs: createNodeFsPort() });
    await appendPriorEntries(config, 3);

    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    const report = await verifyChain(config.fs, path);
    expect(report.firstIssue).toBeUndefined();
    expect(report.validEntries).toHaveLength(3);
    expect(report.validEntries.every((e) => e.runId === RUN_ID)).toBe(true);
  });

  it("is a no-op for count = 0", async () => {
    const dir = freshDir();
    const config = resolveStoreConfig({ journalDir: dir, fs: createNodeFsPort() });
    await appendPriorEntries(config, 0);

    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    const report = await verifyChain(config.fs, path);
    expect(report.validEntries).toHaveLength(0);
  });
});

describe("armedAppend — real (non-broken) path", () => {
  it("appends exactly one more real, valid entry on top of prior state", async () => {
    silenceStdout();
    const dir = freshDir();
    const config = resolveStoreConfig({ journalDir: dir, fs: createNodeFsPort() });
    await appendPriorEntries(config, 2);

    await armedAppend(config, 0);

    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    const report = await verifyChain(config.fs, path);
    expect(report.firstIssue).toBeUndefined();
    expect(report.validEntries).toHaveLength(3);
    expect(report.validEntries[2]?.type).toBe("fanout_rationale");
  });

  it("signals 'before-append' and every real internal step in order", async () => {
    silenceStdout();
    const dir = freshDir();
    const config = resolveStoreConfig({ journalDir: dir, fs: createNodeFsPort() });

    await armedAppend(config, 0);

    const signalled = stdoutSpy!.mock.calls.map((call: unknown[]) => String(call[0])).join("");
    expect(signalled).toContain("before-append");
    expect(signalled).toContain("after-open-file");
    expect(signalled).toContain("after-fsync-dir");
  });
});

describe("armedAppend — EO_CRASH_FIXTURE_BROKEN=1 path", () => {
  it("delegates to the deliberately unsafe brokenArmedAppend when the env flag is set", async () => {
    silenceStdout();
    process.env["EO_CRASH_FIXTURE_BROKEN"] = "1";
    const dir = freshDir();
    const config = resolveStoreConfig({ journalDir: dir, fs: createNodeFsPort() });
    await appendPriorEntries(config, 1);

    await armedAppend(config, 0);

    // The broken path truncates+rewrites unsynced — when NOT killed
    // mid-write (this in-process call runs to completion), the final
    // content is the full rewrite, which does NOT chain-validate as the
    // real appendEntry format would (no prevHash/hash continuity for the
    // "broken" fake line) — this is exactly why crash-suite.test.ts's
    // corruption-detection test relies on killing it MID-write; running it
    // to completion here just proves the code path was reached and ran
    // without throwing.
    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(path, "utf8");
    expect(content).toContain('"broken":true');
  });
});

describe("brokenArmedAppend — direct", () => {
  it("truncates and rewrites the segment file, leaving the fake marker line present when run to completion", async () => {
    silenceStdout();
    const dir = freshDir();
    const config = resolveStoreConfig({ journalDir: dir, fs: createNodeFsPort() });
    await appendPriorEntries(config, 2);

    await brokenArmedAppend(config, 0);

    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(path, "utf8");
    expect(content).toContain('"broken":true');
  });
});

describe("armedSnapshot", () => {
  it("writes a real, loadable snapshot and signals 'before-snapshot' plus every real internal step", async () => {
    silenceStdout();
    const dir = freshDir();
    const config = resolveStoreConfig({ journalDir: dir, fs: createNodeFsPort() });
    await appendPriorEntries(config, 2);

    await armedSnapshot(config, 2, 0);

    const loaded = await loadLatestSnapshot(config, RUN_ID);
    expect(loaded?.journalSequenceNumber).toBe(2);
    expect(loaded?.runState).toBe("running");

    const signalled = stdoutSpy!.mock.calls.map((call: unknown[]) => String(call[0])).join("");
    expect(signalled).toContain("before-snapshot");
    expect(signalled).toContain("after-rename");
  });
});
