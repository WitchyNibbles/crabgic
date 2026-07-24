import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
} from "@eo/testkit";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "../test-support/minimal-compiled-profile.js";
import { compareShadowOutcome, runShadowComparison } from "./shadow-comparator.js";

const PRIMARY_WORK_UNIT_ID = "11111111-1111-4111-8111-111111111111";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-learning-shadow-comparator-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("runShadowComparison", () => {
  it("reports 'improved' when the baseline failed and the shadow (with lesson) succeeds", async () => {
    const script = buildFakeEngineScript({
      structuredOutput: buildWorkerResult({ outcome: "succeeded", summary: "fixed by lesson" }),
    });
    const { comparison } = await runShadowComparison(
      {
        adapter: new FakeEngineAdapter(script),
        packet: buildTaskPacket({ workUnitId: PRIMARY_WORK_UNIT_ID }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        journal: store,
        primaryWorkUnitId: PRIMARY_WORK_UNIT_ID,
      },
      { passed: false, summary: "baseline: schema violation" },
    );
    expect(comparison.verdict).toBe("improved");
  });

  it("reports 'regressed' when the baseline passed but the shadow now fails", async () => {
    const script = buildFakeEngineScript({ failure: { kind: "schemaViolation" } });
    const { comparison } = await runShadowComparison(
      {
        adapter: new FakeEngineAdapter(script),
        packet: buildTaskPacket({ workUnitId: PRIMARY_WORK_UNIT_ID }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        journal: store,
        primaryWorkUnitId: PRIMARY_WORK_UNIT_ID,
      },
      { passed: true, summary: "baseline: succeeded" },
    );
    expect(comparison.verdict).toBe("regressed");
  });

  it("reports 'unchanged' when both baseline and shadow agree (both pass)", async () => {
    const script = buildFakeEngineScript({
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const { comparison } = await runShadowComparison(
      {
        adapter: new FakeEngineAdapter(script),
        packet: buildTaskPacket({ workUnitId: PRIMARY_WORK_UNIT_ID }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        journal: store,
        primaryWorkUnitId: PRIMARY_WORK_UNIT_ID,
      },
      { passed: true },
    );
    expect(comparison.verdict).toBe("unchanged");
  });

  it("reports 'unchanged' when both baseline and shadow agree (both fail)", () => {
    const comparison = compareShadowOutcome(
      { passed: false },
      {
        sessionId: "s1",
        validation: { kind: "schemaViolation", reason: "absent", diagnostics: [] },
        workerResult: undefined,
        artifacts: undefined as never,
      },
    );
    expect(comparison.verdict).toBe("unchanged");
  });
});
