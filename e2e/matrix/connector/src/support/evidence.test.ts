/**
 * Unit tests for this harness's own `support/evidence.ts` helper — not a
 * connector-matrix scenario itself, but the shared plumbing every scenario
 * file depends on (this repo's own coding-style rule: exercise the
 * harness's own logic directly, not just through end-to-end scenarios).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTOR_MATRIX_GATE_TAG,
  createScenarioJournal,
  digestOf,
  emitScenarioEvidence,
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

    const entries: unknown[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
    expect((entries[0] as { payload: { id: string } }).payload.id).toBe(record.id);
  });
});
