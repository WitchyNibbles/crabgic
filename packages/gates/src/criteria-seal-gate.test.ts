import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, journalCriteriaSeal, type JournalStore } from "@crabgic/journal";
import { buildRequirement } from "@crabgic/testkit";
import { createGateRegistry } from "./registry.js";
import { registerCriteriaSealGate } from "./criteria-seal-gate.js";

const CHANGE_SET_ID = "11111111-1111-4111-8111-111111111111";
const REQ_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const OBJECT_ID = "a".repeat(40);

let dir: string;
let journal: JournalStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eo-gates-criteria-seal-"));
  journal = createJournalStore({ journalDir: join(dir, "journal") });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function context() {
  return {
    stage: "final_verifying" as const,
    changeSetId: CHANGE_SET_ID,
    objectId: OBJECT_ID,
    journal,
  };
}

describe("registerCriteriaSealGate", () => {
  it("registers under the existing `acceptance` risk tag — no new tag invented", async () => {
    const registry = createGateRegistry();
    registerCriteriaSealGate(registry, { requirements: () => [] });

    const results = await registry.fireByTag("acceptance", context());
    expect(results).toHaveLength(1);
    expect(results[0]!.tag).toBe("acceptance");
  });

  it("PASSES and emits a schema-valid EvidenceRecord when every seal verifies", async () => {
    const requirement = buildRequirement({ id: REQ_ID });
    await journalCriteriaSeal(journal, {
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { [REQ_ID]: requirement.criteriaHash },
    });

    const registry = createGateRegistry();
    registerCriteriaSealGate(registry, { requirements: () => [requirement] });

    const [result] = await registry.fireByTag("acceptance", context());
    expect(result!.verdict.passed).toBe(true);
    expect(result!.verdict.exitStatus).toBe(0);
    // The evidence is journaled through the registry's single emit path.
    expect(result!.evidence.gateVerdict).toBe("passed");
    expect(result!.evidence.objectId).toBe(OBJECT_ID);
  });

  it("BLOCKS on a post-approval criteria edit, and still emits evidence of the refusal", async () => {
    const approved = buildRequirement({ id: REQ_ID, acceptanceCriteria: ["The real bar"] });
    await journalCriteriaSeal(journal, {
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { [REQ_ID]: approved.criteriaHash },
    });
    // The integrated candidate carries a widened, self-consistent bar.
    const widened = buildRequirement({ id: REQ_ID, acceptanceCriteria: ["Anything goes"] });

    const registry = createGateRegistry();
    registerCriteriaSealGate(registry, { requirements: () => [widened] });

    const [result] = await registry.fireByTag("acceptance", context());
    expect(result!.verdict.passed).toBe(false);
    expect(result!.verdict.exitStatus).toBe(1);
    expect(result!.verdict.detail).toContain("approval_seal_mismatch");
    // Converted to a blocking verdict rather than thrown, so the refusal is
    // ON RECORD — the same choice the perf gate makes for a hash-link failure.
    expect(result!.evidence.gateVerdict).toBe("failed");
  });

  it("BLOCKS a never-sealed change set — fail-closed at the final gate too", async () => {
    const registry = createGateRegistry();
    registerCriteriaSealGate(registry, {
      requirements: () => [buildRequirement({ id: REQ_ID })],
    });

    const [result] = await registry.fireByTag("acceptance", context());
    expect(result!.verdict.passed).toBe(false);
    expect(result!.verdict.detail).toContain("no_approval_seal");
  });

  it("passes a change set that owns no requirements", async () => {
    const registry = createGateRegistry();
    registerCriteriaSealGate(registry, { requirements: () => [] });

    const [result] = await registry.fireByTag("acceptance", context());
    expect(result!.verdict.passed).toBe(true);
  });
});
