/**
 * What the production gate-registry composition root actually registers — and,
 * just as load-bearing, what it does NOT.
 *
 * The registered-gate list is asserted by DEEP EQUALITY, not `toContain`. That
 * is the pinned residual: registering 14's own gate tranche or 15's performance
 * gate reddens this file and has to be acknowledged, rather than arriving
 * silently beside a doc comment that says they are deferred.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Requirement, WorkUnit } from "@crabgic/contracts";
import { createJournalStore, journalCriteriaSeal, type JournalStore } from "@crabgic/journal";
import {
  UnresolvedRequirementError,
  createRequirementsRegistry,
  createWorkUnitsRegistry,
  type Registry,
} from "@crabgic/supervisor";
import { buildRequirement, buildWorkUnit } from "@crabgic/testkit";
import {
  COMPOSED_GATE_NAMES,
  changeSetRequirementIds,
  composeGateRegistry,
} from "./compose-gate-registry.js";

const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_CHANGE_SET_ID = "33333333-3333-4333-8333-333333333333";
const UNIT_A = "44444444-4444-4444-8444-444444444444";
const UNIT_B = "55555555-5555-4555-8555-555555555555";
const REQ_1 = "66666666-6666-4666-8666-666666666666";
const REQ_2 = "77777777-7777-4777-8777-777777777777";
const OBJECT_ID = "b".repeat(40);

let dir: string;
let journal: JournalStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eo-compose-gates-"));
  journal = createJournalStore({ journalDir: join(dir, "journal") });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

function units(records: readonly WorkUnit[]): Registry<WorkUnit> {
  const registry = createWorkUnitsRegistry();
  for (const record of records) registry.put(record);
  return registry;
}

function requirements(records: readonly Requirement[]): Registry<Requirement> {
  const registry = createRequirementsRegistry();
  for (const record of records) registry.put(record);
  return registry;
}

function unit(id: string, changeSetId: string, requirementIds: readonly string[]): WorkUnit {
  return buildWorkUnit({
    id,
    changeSetId,
    dependsOn: [],
    attemptStatus: "pending",
    requirementIds: [...requirementIds],
  });
}

describe("the registered gate set is pinned", () => {
  it("registers EXACTLY the criteria-seal gate, under the existing `acceptance` tag", () => {
    const registry = composeGateRegistry({
      requirements: requirements([]),
      workUnits: units([]),
    });

    // Deep equality: a `toContain` would let a silent addition through.
    expect(registry.list().map((gate) => gate.name)).toStrictEqual([...COMPOSED_GATE_NAMES]);
    expect(COMPOSED_GATE_NAMES).toStrictEqual(["criteria-seal"]);
    expect(registry.list().map((gate) => gate.tag)).toStrictEqual(["acceptance"]);
    // The deferred tranches are ABSENT, not merely undocumented.
    expect(registry.list("performance")).toEqual([]);
    expect(registry.list("tdd")).toEqual([]);
    expect(registry.list("coverage")).toEqual([]);
    expect(registry.list("security")).toEqual([]);
    expect(registry.list("engine-conformance")).toEqual([]);
  });
});

describe("the composed requirements reader", () => {
  it("resolves the WHOLE change set's requirement union, not one unit's — the blind spot the gate exists to cover", async () => {
    const first = buildRequirement({ id: REQ_1 });
    const second = buildRequirement({ id: REQ_2 });
    await journalCriteriaSeal(journal, {
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { [REQ_1]: first.criteriaHash, [REQ_2]: second.criteriaHash },
    });

    const registry = composeGateRegistry({
      requirements: requirements([first, second]),
      // Two units, one requirement each — a per-unit reader would verify one.
      workUnits: units([
        unit(UNIT_A, CHANGE_SET_ID, [REQ_1]),
        unit(UNIT_B, CHANGE_SET_ID, [REQ_2]),
      ]),
    });

    const results = await registry.fireByTag("acceptance", {
      stage: "final_verifying",
      changeSetId: CHANGE_SET_ID,
      objectId: OBJECT_ID,
      journal,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.verdict.passed).toBe(true);
    // The verdict's own count is what proves BOTH were verified. A reader scoped
    // to one unit would report 1 here and still pass.
    expect(JSON.parse(results[0]!.verdict.detail) as { verified: number }).toStrictEqual({
      verified: 2,
    });
  });

  it("reads the records WHEN IT FIRES, so a post-registration tamper is caught", async () => {
    const approved = buildRequirement({ id: REQ_1, acceptanceCriteria: ["as approved"] });
    const tampered = buildRequirement({
      id: REQ_1,
      acceptanceCriteria: ["as approved", "and more"],
    });
    expect(tampered.criteriaHash).not.toBe(approved.criteriaHash);
    await journalCriteriaSeal(journal, {
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { [REQ_1]: approved.criteriaHash },
    });

    const registryStore = requirements([approved]);
    const registry = composeGateRegistry({
      requirements: registryStore,
      workUnits: units([unit(UNIT_A, CHANGE_SET_ID, [REQ_1])]),
    });
    // The edit lands AFTER registration. A reader that snapshotted at
    // registration time would still see the approved record and pass.
    registryStore.put(tampered);

    const results = await registry.fireByTag("acceptance", {
      stage: "final_verifying",
      changeSetId: CHANGE_SET_ID,
      objectId: OBJECT_ID,
      journal,
    });
    expect(results[0]?.verdict.passed).toBe(false);
    expect(results[0]?.verdict.detail).toContain("approval_seal_mismatch");
    expect(results[0]?.verdict.detail).toContain(REQ_1);
    // Ids and hashes only — never the attacker-authored criteria text.
    expect(results[0]?.verdict.detail).not.toContain("and more");
  });

  it("REFUSES rather than shrinking the bar when a declared id resolves to no record", async () => {
    await journalCriteriaSeal(journal, {
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { [REQ_1]: "sha256:whatever" },
    });
    const registry = composeGateRegistry({
      // `requirements.json` holds nothing; the unit declares an id anyway.
      requirements: requirements([]),
      workUnits: units([unit(UNIT_A, CHANGE_SET_ID, [REQ_1])]),
    });

    await expect(
      registry.fireByTag("acceptance", {
        stage: "final_verifying",
        changeSetId: CHANGE_SET_ID,
        objectId: OBJECT_ID,
        journal,
      }),
    ).rejects.toThrow(UnresolvedRequirementError);
  });
});

describe("changeSetRequirementIds", () => {
  it("unions every unit's declared ids, deduped, in first-seen order", () => {
    const registry = units([
      unit(UNIT_A, CHANGE_SET_ID, [REQ_2, REQ_1]),
      unit(UNIT_B, CHANGE_SET_ID, [REQ_1]),
    ]);
    expect(changeSetRequirementIds(registry, CHANGE_SET_ID)).toStrictEqual([REQ_2, REQ_1]);
  });

  it("never leaks another change set's requirements", () => {
    const registry = units([
      unit(UNIT_A, CHANGE_SET_ID, [REQ_1]),
      unit(UNIT_B, OTHER_CHANGE_SET_ID, [REQ_2]),
    ]);
    expect(changeSetRequirementIds(registry, CHANGE_SET_ID)).toStrictEqual([REQ_1]);
  });

  it("is empty for a change set whose units declare nothing — the chore unit, not a missing record", () => {
    expect(
      changeSetRequirementIds(units([unit(UNIT_A, CHANGE_SET_ID, [])]), CHANGE_SET_ID),
    ).toEqual([]);
  });
});
