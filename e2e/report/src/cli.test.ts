import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type EvidenceRecord } from "@crabgic/contracts";
import type { JournalEntry, JournalEntryFilter } from "@crabgic/journal";
import {
  DEFAULT_JOURNAL_DIR,
  DEFAULT_OUT_FILE,
  resolveReleaseGateCliSettings,
  runReleaseGateReportCli,
} from "./cli.js";
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

/** Sets one env var for the duration of `body`, restoring the previous state (including "absent") after. */
async function withEnv(name: string, value: string, body: () => Promise<void>): Promise<void> {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    await body();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
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

  it("honors CRABGIC_RELEASE_GATE_MODE=final when scoringMode isn't passed explicitly", async () => {
    const outFile = join(outDir, "env-mode-report.json");
    const prev = process.env["CRABGIC_RELEASE_GATE_MODE"];
    process.env["CRABGIC_RELEASE_GATE_MODE"] = "final";
    try {
      const { report } = await runReleaseGateReportCli({
        journal: inMemoryJournal([]),
        releaseCandidateObjectId: "obj",
        outFile,
      });
      expect(report.scoringMode).toBe("final");
    } finally {
      if (prev === undefined) delete process.env["CRABGIC_RELEASE_GATE_MODE"];
      else process.env["CRABGIC_RELEASE_GATE_MODE"] = prev;
    }
  });

  it("ignores a garbage CRABGIC_RELEASE_GATE_MODE value and falls back to 'interim'", async () => {
    const outFile = join(outDir, "garbage-mode-report.json");
    const prev = process.env["CRABGIC_RELEASE_GATE_MODE"];
    process.env["CRABGIC_RELEASE_GATE_MODE"] = "not-a-real-mode";
    try {
      const { report } = await runReleaseGateReportCli({
        journal: inMemoryJournal([]),
        releaseCandidateObjectId: "obj",
        outFile,
      });
      expect(report.scoringMode).toBe("interim");
    } finally {
      if (prev === undefined) delete process.env["CRABGIC_RELEASE_GATE_MODE"];
      else process.env["CRABGIC_RELEASE_GATE_MODE"] = prev;
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

  it("honors a non-empty CRABGIC_RELEASE_CANDIDATE_OBJECT_ID", async () => {
    const outFile = join(outDir, "env-object-id-report.json");
    await withEnv("CRABGIC_RELEASE_CANDIDATE_OBJECT_ID", "e".repeat(40), async () => {
      const { report } = await runReleaseGateReportCli({
        journal: inMemoryJournal([]),
        outFile,
      });
      expect(report.releaseCandidateObjectId).toBe("e".repeat(40));
    });
  });

  /**
   * A GitHub Actions `${{ inputs.x }}` expression for an OMITTED optional
   * input renders as the EMPTY STRING, not as an absent variable — so the
   * env var arrives present-and-empty, `??` does not fire, and the
   * generator scores every item against object ID `""`, linking zero
   * evidence while looking perfectly healthy. Empty must mean "unset",
   * exactly as `e2e/attestation/src/evidence.ts`'s
   * `resolveReleaseCandidateObjectId` already treats it.
   */
  it('treats an EMPTY CRABGIC_RELEASE_CANDIDATE_OBJECT_ID as unset, not as the object ID ""', async () => {
    const outFile = join(outDir, "empty-object-id-report.json");
    await withEnv("CRABGIC_RELEASE_CANDIDATE_OBJECT_ID", "", async () => {
      const { report } = await runReleaseGateReportCli({
        journal: inMemoryJournal([]),
        outFile,
      });
      expect(report.releaseCandidateObjectId).not.toBe("");
      expect(report.releaseCandidateObjectId).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  it("still prefers an explicit option over any env value", async () => {
    const outFile = join(outDir, "explicit-object-id-report.json");
    await withEnv("CRABGIC_RELEASE_CANDIDATE_OBJECT_ID", "f".repeat(40), async () => {
      const { report } = await runReleaseGateReportCli({
        journal: inMemoryJournal([]),
        releaseCandidateObjectId: "explicit-obj",
        outFile,
      });
      expect(report.releaseCandidateObjectId).toBe("explicit-obj");
    });
  });

  /**
   * Proves the CLI resolves `journalDir` through the same
   * empty-is-unset path the settings resolver defines, rather than through
   * a bare `??` of its own — the reported `journalDir` IS the value handed
   * to `createJournalStore`.
   */
  it("reports the journal directory it resolved from CRABGIC_RELEASE_GATE_JOURNAL_DIR", async () => {
    const journalDir = join(outDir, "shared-journal");
    await withEnv("CRABGIC_RELEASE_GATE_JOURNAL_DIR", journalDir, async () => {
      const result = await runReleaseGateReportCli({
        journal: inMemoryJournal([]),
        releaseCandidateObjectId: "obj",
        outFile: join(outDir, "journal-env-report.json"),
      });
      expect(result.journalDir).toBe(journalDir);
    });
  });

  it('falls back to the default journal directory when CRABGIC_RELEASE_GATE_JOURNAL_DIR is EMPTY, never to ""', async () => {
    await withEnv("CRABGIC_RELEASE_GATE_JOURNAL_DIR", "", async () => {
      const result = await runReleaseGateReportCli({
        journal: inMemoryJournal([]),
        releaseCandidateObjectId: "obj",
        outFile: join(outDir, "empty-journal-env-report.json"),
      });
      expect(result.journalDir).not.toBe("");
      expect(result.journalDir).toBe(DEFAULT_JOURNAL_DIR);
    });
  });

  it("honors a non-empty CRABGIC_RELEASE_GATE_OUT_FILE", async () => {
    const outFile = join(outDir, "env-out-file-report.json");
    await withEnv("CRABGIC_RELEASE_GATE_OUT_FILE", outFile, async () => {
      const result = await runReleaseGateReportCli({
        journal: inMemoryJournal([]),
        releaseCandidateObjectId: "obj",
      });
      expect(result.outFile).toBe(outFile);
      const written = JSON.parse(await readFile(outFile, "utf-8")) as unknown;
      expect(ReleaseGateReportSchema.parse(written).releaseCandidateObjectId).toBe("obj");
    });
  });
});

/**
 * EMPTY MEANS UNSET, AT EVERY SITE.
 *
 * `releaseCandidateObjectId` was fixed for this in isolation while
 * `journalDir` and `outFile` kept the plain `?? process.env[...] ?? DEFAULT`
 * shape, so an empty value would silently become the path `""`. Not
 * reachable today — `CRABGIC_RELEASE_GATE_JOURNAL_DIR` comes from
 * `${{ runner.temp }}/...` and `CRABGIC_RELEASE_GATE_OUT_FILE` is set nowhere —
 * but `CRABGIC_RELEASE_GATE_JOURNAL_DIR` is now the load-bearing wiring for
 * EVERY checklist item's evidence, so a future `${{ inputs.x }}` on it
 * would point the whole run at the wrong journal and produce a
 * zero-evidence report that looks perfectly healthy.
 *
 * Asserted against the PURE resolver rather than through
 * `runReleaseGateReportCli`, because the discriminating `outFile` case
 * would otherwise have to write to `DEFAULT_OUT_FILE` — the repo's real,
 * committed `e2e/release-gate-report.json`.
 */
describe("resolveReleaseGateCliSettings — empty env values mean unset", () => {
  const cases = [
    {
      env: "CRABGIC_RELEASE_GATE_JOURNAL_DIR",
      read: (s: ReturnType<typeof resolveReleaseGateCliSettings>) => s.journalDir,
      value: "/tmp/eo-some-journal",
      fallback: DEFAULT_JOURNAL_DIR,
      option: { journalDir: "/tmp/eo-explicit-journal" },
      explicit: "/tmp/eo-explicit-journal",
    },
    {
      env: "CRABGIC_RELEASE_GATE_OUT_FILE",
      read: (s: ReturnType<typeof resolveReleaseGateCliSettings>) => s.outFile,
      value: "/tmp/eo-some-report.json",
      fallback: DEFAULT_OUT_FILE,
      option: { outFile: "/tmp/eo-explicit-report.json" },
      explicit: "/tmp/eo-explicit-report.json",
    },
  ] as const;

  /**
   * Every call pins `releaseCandidateObjectId` explicitly so these cases
   * never shell out to `git rev-parse` — the site under test here is the
   * path resolution, and an incidental repository dependency would make the
   * file fail to run inside a `.git`-less export.
   */
  const pinned = { releaseCandidateObjectId: "obj" } as const;

  for (const testCase of cases) {
    it(`${testCase.env}: absent -> default`, () => {
      const previous = process.env[testCase.env];
      delete process.env[testCase.env];
      try {
        expect(testCase.read(resolveReleaseGateCliSettings(pinned))).toBe(testCase.fallback);
      } finally {
        if (previous !== undefined) process.env[testCase.env] = previous;
      }
    });

    it(`${testCase.env}: set -> used verbatim`, async () => {
      await withEnv(testCase.env, testCase.value, async () => {
        expect(testCase.read(resolveReleaseGateCliSettings(pinned))).toBe(testCase.value);
      });
    });

    it(`${testCase.env}: EMPTY -> default, never ""`, async () => {
      await withEnv(testCase.env, "", async () => {
        const resolved = testCase.read(resolveReleaseGateCliSettings(pinned));
        expect(resolved).not.toBe("");
        expect(resolved).toBe(testCase.fallback);
      });
    });

    it(`${testCase.env}: an explicit option still wins`, async () => {
      await withEnv(testCase.env, testCase.value, async () => {
        expect(
          testCase.read(resolveReleaseGateCliSettings({ ...pinned, ...testCase.option })),
        ).toBe(testCase.explicit);
      });
    });
  }

  it("CRABGIC_RELEASE_GATE_MODE: EMPTY -> 'interim'", async () => {
    await withEnv("CRABGIC_RELEASE_GATE_MODE", "", async () => {
      expect(resolveReleaseGateCliSettings({ releaseCandidateObjectId: "obj" }).scoringMode).toBe(
        "interim",
      );
    });
  });
});
