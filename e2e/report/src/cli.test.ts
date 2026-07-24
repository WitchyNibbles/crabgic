import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type EvidenceRecord } from "@eo/contracts";
import type { JournalEntry, JournalEntryFilter } from "@eo/journal";
import { runReleaseGateReportCli } from "./cli.js";
import { ReleaseGateReportSchema } from "./schema.js";
import type { ReleaseGateChecklistItemSpec } from "./checklist.js";

/**
 * `runReleaseGateReportCli` unit tests — the `.github/workflows/release-
 * e2e.yml` entrypoint's testable core (the `process.exit` glue itself is
 * `c8 ignore`d, mirroring `packages/gates/src/drift/cli.ts`'s own split).
 */

function fixtureRecord(objectId: string, gateTag: string, exitStatus: number): EvidenceRecord {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    changeSetId: randomUUID(),
    command: "cli-fixture",
    exitStatus,
    toolchainFingerprint: "cli-toolchain@1",
    capturedAt: new Date().toISOString(),
    artifactDigests: ["sha256:" + "d".repeat(64)],
    objectId,
    gateTag,
  };
}

/** A minimal in-memory `EvidenceJournalReader` — no real journal I/O needed for these tests. */
function inMemoryJournal(entries: readonly JournalEntry[]) {
  return {
    async *queryEntries(filter?: JournalEntryFilter) {
      for (const entry of entries) {
        if (filter?.type !== undefined && entry.type !== filter.type) continue;
        yield entry;
      }
    },
  };
}

function evidenceEntry(seq: number, record: EvidenceRecord): JournalEntry {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    seq,
    prevHash: "0".repeat(64),
    hash: "1".repeat(64),
    timestamp: new Date().toISOString(),
    type: "evidence_pointer",
    payload: record,
  };
}

let outDir: string;

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), "eo-release-gate-cli-test-"));
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe("runReleaseGateReportCli", () => {
  it("writes a schema-valid report to outFile and returns it", async () => {
    const candidate = "cli-candidate-obj";
    const checklist: readonly ReleaseGateChecklistItemSpec[] = [
      { id: "only-item", description: "d", required: true, requiredGateTags: ["t"] },
    ];
    const journal = inMemoryJournal([evidenceEntry(1, fixtureRecord(candidate, "t", 0))]);
    const outFile = join(outDir, "release-gate-report.json");

    const { report, outFile: returnedPath } = await runReleaseGateReportCli({
      journal,
      releaseCandidateObjectId: candidate,
      scoringMode: "final",
      outFile,
      checklist,
      now: () => "2026-02-02T00:00:00.000Z",
    });

    expect(returnedPath).toBe(outFile);
    expect(report.overallVerdict).toBe("PASS");

    const written = JSON.parse(await readFile(outFile, "utf-8")) as unknown;
    expect(ReleaseGateReportSchema.parse(written)).toEqual(report);
  });

  it("creates any missing parent directories for outFile", async () => {
    const nested = join(outDir, "nested", "dir", "release-gate-report.json");
    await runReleaseGateReportCli({
      journal: inMemoryJournal([]),
      releaseCandidateObjectId: "obj",
      scoringMode: "interim",
      outFile: nested,
    });
    const written = JSON.parse(await readFile(nested, "utf-8")) as unknown;
    expect(ReleaseGateReportSchema.parse(written).overallVerdict).toBe("EVIDENCE-PENDING");
  });

  it("propagates a real FAIL (nonzero exitStatus evidence) all the way to the persisted report", async () => {
    const candidate = "cli-candidate-fail";
    const journal = inMemoryJournal([evidenceEntry(1, fixtureRecord(candidate, "t", 1))]);
    const outFile = join(outDir, "fail-report.json");

    const { report } = await runReleaseGateReportCli({
      journal,
      releaseCandidateObjectId: candidate,
      scoringMode: "final",
      outFile,
    });

    expect(report.overallVerdict).toBe("FAIL");
  });

  it("defaults scoringMode to 'interim' when neither options nor env var supply one", async () => {
    const outFile = join(outDir, "default-mode-report.json");
    const { report } = await runReleaseGateReportCli({
      journal: inMemoryJournal([]),
      releaseCandidateObjectId: "obj",
      outFile,
    });
    expect(report.scoringMode).toBe("interim");
  });

  it("honors EO_RELEASE_GATE_MODE=final when scoringMode isn't passed explicitly", async () => {
    const outFile = join(outDir, "env-mode-report.json");
    const prev = process.env["EO_RELEASE_GATE_MODE"];
    process.env["EO_RELEASE_GATE_MODE"] = "final";
    try {
      const { report } = await runReleaseGateReportCli({
        journal: inMemoryJournal([]),
        releaseCandidateObjectId: "obj",
        outFile,
      });
      expect(report.scoringMode).toBe("final");
    } finally {
      if (prev === undefined) delete process.env["EO_RELEASE_GATE_MODE"];
      else process.env["EO_RELEASE_GATE_MODE"] = prev;
    }
  });

  it("ignores a garbage EO_RELEASE_GATE_MODE value and falls back to 'interim'", async () => {
    const outFile = join(outDir, "garbage-mode-report.json");
    const prev = process.env["EO_RELEASE_GATE_MODE"];
    process.env["EO_RELEASE_GATE_MODE"] = "not-a-real-mode";
    try {
      const { report } = await runReleaseGateReportCli({
        journal: inMemoryJournal([]),
        releaseCandidateObjectId: "obj",
        outFile,
      });
      expect(report.scoringMode).toBe("interim");
    } finally {
      if (prev === undefined) delete process.env["EO_RELEASE_GATE_MODE"];
      else process.env["EO_RELEASE_GATE_MODE"] = prev;
    }
  });

  it("resolves releaseCandidateObjectId via `git rev-parse HEAD` when neither options nor env var supply one", async () => {
    const outFile = join(outDir, "git-object-id-report.json");
    const { report } = await runReleaseGateReportCli({
      journal: inMemoryJournal([]),
      outFile,
    });
    // This test runs inside a real git checkout — a real 40-char lowercase hex SHA-1 is expected.
    expect(report.releaseCandidateObjectId).toMatch(/^[0-9a-f]{40}$/);
  });
});
