/**
 * Unit tests for this harness's own `support/evidence.ts` helper — not a
 * connector-matrix scenario itself, but the shared plumbing every scenario
 * file depends on (this repo's own coding-style rule: exercise the
 * harness's own logic directly, not just through end-to-end scenarios).
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJournalStore } from "@eo/journal";
import {
  CONNECTOR_MATRIX_GATE_TAG,
  createScenarioJournal,
  digestOf,
  emitScenarioEvidence,
  recordEmittedEvidenceIds,
  resolveReleaseCandidateObjectId,
  type ScenarioJournal,
} from "./evidence.js";

describe("digestOf", () => {
  it("is deterministic and content-addressed", () => {
    expect(digestOf("hello")).toBe(digestOf("hello"));
    expect(digestOf("hello")).not.toBe(digestOf("world"));
    expect(digestOf("hello")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("resolveReleaseCandidateObjectId", () => {
  const ENV_KEY = "EO_RELEASE_CANDIDATE_OBJECT_ID";
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("honors $EO_RELEASE_CANDIDATE_OBJECT_ID when set (fresh module instance, cache not yet populated)", async () => {
    vi.resetModules();
    process.env[ENV_KEY] = "fixture-release-candidate-object-id";
    const fresh = await import("./evidence.js");
    expect(fresh.resolveReleaseCandidateObjectId()).toBe("fixture-release-candidate-object-id");
  });

  it("falls back to git rev-parse HEAD (a real 40-hex-char object id) when unset", async () => {
    vi.resetModules();
    delete process.env[ENV_KEY];
    const fresh = await import("./evidence.js");
    const objectId = fresh.resolveReleaseCandidateObjectId();
    expect(objectId).toMatch(/^[0-9a-f]{40}$/);
  });

  it("caches across repeated calls within the same module instance", () => {
    const first = resolveReleaseCandidateObjectId();
    const second = resolveReleaseCandidateObjectId();
    expect(first).toBe(second);
  });
});

let tj: ScenarioJournal;

beforeEach(async () => {
  tj = await createScenarioJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

describe("emitScenarioEvidence", () => {
  it("defaults changeSetId to a fresh UUID when not supplied", async () => {
    const record = await emitScenarioEvidence({
      journal: tj.store,
      command: "unit-test: default changeSetId",
      exitStatus: 0,
      outcomeContent: "{}",
    });
    expect(record.changeSetId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("honors an explicit changeSetId when supplied", async () => {
    const record = await emitScenarioEvidence({
      journal: tj.store,
      command: "unit-test: explicit changeSetId",
      exitStatus: 0,
      outcomeContent: "{}",
      changeSetId: "11111111-1111-4111-8111-111111111111",
    });
    expect(record.changeSetId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("carries an explicit requirementId through when supplied, and omits the field entirely when not", async () => {
    const withReq = await emitScenarioEvidence({
      journal: tj.store,
      command: "unit-test: with requirementId",
      exitStatus: 0,
      outcomeContent: "{}",
      requirementId: "22222222-2222-4222-8222-222222222222",
    });
    expect(withReq.requirementId).toBe("22222222-2222-4222-8222-222222222222");

    const withoutReq = await emitScenarioEvidence({
      journal: tj.store,
      command: "unit-test: without requirementId",
      exitStatus: 0,
      outcomeContent: "{}",
    });
    expect(withoutReq.requirementId).toBeUndefined();
  });

  it("always tags the record release-gate:connector-matrix and journals a real, round-trippable evidence_pointer entry", async () => {
    const record = await emitScenarioEvidence({
      journal: tj.store,
      command: "unit-test: gate-tag + round-trip",
      exitStatus: 0,
      outcomeContent: JSON.stringify({ ok: true }),
    });
    expect(record.gateTag).toBe(CONNECTOR_MATRIX_GATE_TAG);

    // Scoped to this record's own freshly-minted `changeSetId`: what is
    // proved is unchanged — that this ONE call appended exactly one
    // durable, round-trippable entry carrying this exact record. A bare
    // journal-wide count only means that while the journal is private;
    // under `EO_RELEASE_GATE_JOURNAL_DIR` (see `./evidence.ts`) every
    // sibling harness's evidence is visible here too.
    const entries: unknown[] = [];
    for await (const entry of tj.store.queryEntries({
      type: "evidence_pointer",
      changeSetId: record.changeSetId,
    })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
    expect((entries[0] as { payload: { id: string } }).payload.id).toBe(record.id);
  });
});

describe("recordEmittedEvidenceIds", () => {
  it("records the id of every EvidenceRecord appended THROUGH it, and nothing appended around it", async () => {
    const emittedIds = new Set<string>();
    const recording = recordEmittedEvidenceIds(tj.store, emittedIds);

    const through = await emitScenarioEvidence({
      journal: recording,
      command: "unit-test: appended through the recorder",
      exitStatus: 0,
      outcomeContent: "{}",
    });
    const around = await emitScenarioEvidence({
      journal: tj.store,
      command: "unit-test: appended around the recorder",
      exitStatus: 0,
      outcomeContent: "{}",
    });

    expect(emittedIds.has(through.id)).toBe(true);
    // The whole point: an entry this file did NOT emit stays invisible to
    // the id-scoped reads the scenario files do — which is what keeps
    // "every record emitted in this file is tagged X" a statement about
    // this file once a shared journal makes siblings' entries visible.
    expect(emittedIds.has(around.id)).toBe(false);
  });

  it("passes non-evidence entries straight through without recording anything", async () => {
    const emittedIds = new Set<string>();
    const recording = recordEmittedEvidenceIds(tj.store, emittedIds);
    const entry = await recording.appendEntry({
      type: "fanout_rationale",
      runId: randomUUID(),
      payload: { rationale: "unit-test: non-evidence entry" },
    });
    expect(entry.type).toBe("fanout_rationale");
    expect(emittedIds.size).toBe(0);
  });
});

describe("createScenarioJournal — shared-journal mode (EO_RELEASE_GATE_JOURNAL_DIR)", () => {
  const SHARED_JOURNAL_DIR_ENV = "EO_RELEASE_GATE_JOURNAL_DIR";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes into the shared directory, creating it if absent, and NEVER deletes it on cleanup", async () => {
    // The load-bearing guarantee: a release run points every harness at one
    // journal so `e2e/report`'s generator can read the evidence back. Were
    // `cleanup()` to remove that directory, the first harness to finish
    // would wipe out every other harness's `EvidenceRecord`s — the very
    // records the report is generated from.
    const parent = await mkdtemp(join(tmpdir(), "eo-connector-shared-journal-test-"));
    const sharedDir = join(parent, "does", "not", "exist", "yet");
    vi.stubEnv(SHARED_JOURNAL_DIR_ENV, sharedDir);

    try {
      const journal = await createScenarioJournal();
      expect(journal.journalDir).toBe(sharedDir);

      const record = await emitScenarioEvidence({
        journal: journal.store,
        command: "unit-test: shared-journal survival",
        exitStatus: 0,
        outcomeContent: "{}",
      });
      await journal.cleanup();

      // Still on disk after cleanup, and still holding the entry — exactly
      // what the report generator needs to find there later.
      expect((await stat(sharedDir)).isDirectory()).toBe(true);
      const surviving: unknown[] = [];
      for await (const entry of createJournalStore({ journalDir: sharedDir }).queryEntries({
        type: "evidence_pointer",
        changeSetId: record.changeSetId,
      })) {
        surviving.push(entry);
      }
      expect(surviving).toHaveLength(1);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("treats an empty value as unset — a private temp directory, really removed", async () => {
    vi.stubEnv(SHARED_JOURNAL_DIR_ENV, "");
    const journal = await createScenarioJournal();
    expect(journal.journalDir).not.toBe("");
    await emitScenarioEvidence({
      journal: journal.store,
      command: "unit-test: private-journal fallback",
      exitStatus: 0,
      outcomeContent: "{}",
    });
    await journal.cleanup();
    await expect(stat(journal.journalDir)).rejects.toThrow();
  });
});
