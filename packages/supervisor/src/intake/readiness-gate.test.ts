import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, findLatestCriteriaSeal, type JournalStore } from "@crabgic/journal";
import { IllegalTransitionError, verifyCriteriaSeal } from "@crabgic/contracts";
import { buildChangeSet, buildRequirement } from "@crabgic/testkit";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import {
  UnmappedRequirementError,
  UnsealableRequirementError,
  transitionChangeSetToReady,
} from "./readiness-gate.js";

const REQ_A = "aaaaaaaa-1111-4111-8111-111111111111";
const REQ_B = "bbbbbbbb-1111-4111-8111-111111111111";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-supervisor-readiness-gate-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("transitionChangeSetToReady", () => {
  it("blocks the ready transition — throws before touching the state machine — when a requirement is unmapped", async () => {
    const changeSets = createChangeSetsRegistry();
    const seed = buildChangeSet({ state: "awaiting_approval" });
    changeSets.put(seed);

    await expect(
      transitionChangeSetToReady({
        journal: store,
        changeSets,
        changeSetId: seed.id,
        requirementIds: [REQ_A, REQ_B],
        workUnits: [{ requirementIds: [REQ_A] }],
        requirements: [buildRequirement({ id: REQ_A }), buildRequirement({ id: REQ_B })],
      }),
    ).rejects.toThrow(UnmappedRequirementError);

    // No journal write and no registry mutation happened.
    let count = 0;
    for await (const _entry of store.queryEntries({ type: "run_transition" })) count++;
    expect(count).toBe(0);
    expect(changeSets.get(seed.id)?.state).toBe("awaiting_approval");
  });

  it("transitions to ready when every requirement is mapped", async () => {
    const changeSets = createChangeSetsRegistry();
    const seed = buildChangeSet({ state: "awaiting_approval" });
    changeSets.put(seed);

    const updated = await transitionChangeSetToReady({
      journal: store,
      changeSets,
      changeSetId: seed.id,
      requirementIds: [REQ_A, REQ_B],
      workUnits: [{ requirementIds: [REQ_A, REQ_B] }],
      requirements: [buildRequirement({ id: REQ_A }), buildRequirement({ id: REQ_B })],
    });

    expect(updated.state).toBe("ready");
  });

  /**
   * roadmap/24. Sealing lives HERE, in the single funnel both activation
   * paths already share, rather than in each caller. A per-caller seal is
   * exactly the shape the donor's first completion seal shipped with — one
   * path threaded it, the daemon path did not, and the gap was invisible
   * because every test injected the option. Here `ready` is unreachable
   * without a seal because the compiler will not let a caller omit the
   * records it is sealed from.
   */
  it("seals every requirement's criteria at the ready transition", async () => {
    const changeSets = createChangeSetsRegistry();
    const seed = buildChangeSet({ state: "awaiting_approval" });
    changeSets.put(seed);
    const reqA = buildRequirement({ id: REQ_A, acceptanceCriteria: ["A holds"] });
    const reqB = buildRequirement({ id: REQ_B, acceptanceCriteria: ["B holds"] });

    await transitionChangeSetToReady({
      journal: store,
      changeSets,
      changeSetId: seed.id,
      requirementIds: [REQ_A, REQ_B],
      workUnits: [{ requirementIds: [REQ_A, REQ_B] }],
      requirements: [reqA, reqB],
    });

    const seal = await findLatestCriteriaSeal(store, seed.id);
    expect(seal?.criteriaHashes[REQ_A]).toBe(reqA.criteriaHash);
    expect(seal?.criteriaHashes[REQ_B]).toBe(reqB.criteriaHash);
    // The seal verifies against the very records it was taken from.
    expect(verifyCriteriaSeal(reqA, seal).ok).toBe(true);
  });

  it("refuses to seal — and so refuses to ready — when a declared requirement has no record", async () => {
    const changeSets = createChangeSetsRegistry();
    const seed = buildChangeSet({ state: "awaiting_approval" });
    changeSets.put(seed);

    await expect(
      transitionChangeSetToReady({
        journal: store,
        changeSets,
        changeSetId: seed.id,
        requirementIds: [REQ_A, REQ_B],
        workUnits: [{ requirementIds: [REQ_A, REQ_B] }],
        // REQ_B declared by the contract, but its record is missing.
        requirements: [buildRequirement({ id: REQ_A })],
      }),
    ).rejects.toThrow(UnsealableRequirementError);

    // Fails BEFORE the transition: an unsealable ChangeSet never reaches ready.
    expect(changeSets.get(seed.id)?.state).toBe("awaiting_approval");
  });

  it("still surfaces IllegalTransitionError for full coverage but an illegal source state", async () => {
    const changeSets = createChangeSetsRegistry();
    const seed = buildChangeSet({ state: "draft" });
    changeSets.put(seed);

    await expect(
      transitionChangeSetToReady({
        journal: store,
        changeSets,
        changeSetId: seed.id,
        requirementIds: [],
        workUnits: [],
        requirements: [],
      }),
    ).rejects.toThrow(IllegalTransitionError);
  });
});
