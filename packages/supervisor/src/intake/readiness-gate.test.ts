import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, findLatestCriteriaSeal, type JournalStore } from "@crabgic/journal";
import { IllegalTransitionError, verifyCriteriaSeal } from "@crabgic/contracts";
import { buildChangeSet, buildRequirement } from "@crabgic/testkit";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import type { StageCompletionRecord } from "@crabgic/contracts";
import {
  DesignGateNotClosedError,
  UnmappedRequirementError,
  UnsealableRequirementError,
  transitionChangeSetToReady,
} from "./readiness-gate.js";

/**
 * A closed `design-gate` for the ChangeSet under test — owner ruling R8.
 *
 * Every pre-R8 case below supplies one. That is not fixture noise: those cases
 * assert what happens AFTER the design gate passes, and before R8 there was no
 * gate to pass. Omitting it would silently convert each of them into a test of
 * the new refusal rather than of the behaviour it was written for.
 */
function designGateClosed(changeSetId: string): StageCompletionRecord[] {
  return [
    {
      schemaVersion: 1,
      changeSetId,
      stage: "design-gate",
      round: 1,
      artifactRef: "design-record:test",
      closedAt: "2026-08-16T00:00:00.000Z",
    },
  ];
}

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
        stageCompletions: designGateClosed(seed.id),
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
      stageCompletions: designGateClosed(seed.id),
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
      stageCompletions: designGateClosed(seed.id),
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
        stageCompletions: designGateClosed(seed.id),
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
        stageCompletions: designGateClosed(seed.id),
      }),
    ).rejects.toThrow(IllegalTransitionError);
  });
});

/**
 * Owner ruling R8 (2026-08-16), work item 4 — the design gate binds the RUN.
 *
 * R2 ruled the `design-gate` "placed _before_ dispatch". It was not: measured
 * 2026-08-16, `resolveDesignGate` had zero references anywhere in the run path,
 * so the gate decided only whether a review stage could close and nothing asked
 * it before dispatching
 * (`docs/evidence/criteria-closeout/defects/25-design-gate-not-consulted-by-dispatch.md`).
 *
 * This gate is where it binds. `transitionChangeSetToReady` is the only path
 * from `awaiting_approval` to `ready`, and `ready` is what dispatch requires.
 */
describe("design-gate readiness — R8", () => {
  function setup() {
    const changeSets = createChangeSetsRegistry();
    const seed = buildChangeSet({ state: "awaiting_approval" });
    changeSets.put(seed);
    return {
      seed,
      changeSets,
      base: {
        journal: store,
        changeSets,
        changeSetId: seed.id,
        requirementIds: [REQ_A],
        workUnits: [{ requirementIds: [REQ_A] }],
        requirements: [buildRequirement({ id: REQ_A })],
      },
    };
  }

  it("refuses ready when the design-gate stage has not closed", async () => {
    const { base } = setup();
    await expect(transitionChangeSetToReady({ ...base, stageCompletions: [] })).rejects.toThrow(
      DesignGateNotClosedError,
    );
  });

  it("names the gate in the refusal, so an operator knows which of two things to do", async () => {
    // Run the pipeline's design stage, or approve the design already on record.
    // A bare "not ready" sends them to the wrong one.
    const { base } = setup();
    await expect(transitionChangeSetToReady({ ...base, stageCompletions: [] })).rejects.toThrow(
      /design-gate/,
    );
  });

  it("allows ready when the design-gate stage has closed for this change set", async () => {
    // The positive control. Without it every refusal here would pass for a gate
    // that can never be opened at all.
    const { base, seed } = setup();
    const result = await transitionChangeSetToReady({
      ...base,
      stageCompletions: designGateClosed(seed.id),
    });
    expect(result.state).toBe("ready");
  });

  it("refuses when the closure belongs to a DIFFERENT change set", async () => {
    // Otherwise one approved design authorizes every run after it.
    const { base } = setup();
    await expect(
      transitionChangeSetToReady({
        ...base,
        stageCompletions: designGateClosed("99999999-9999-4999-8999-999999999999"),
      }),
    ).rejects.toThrow(DesignGateNotClosedError);
  });

  it("refuses when some OTHER stage closed but design-gate did not", async () => {
    // A store with records in it must not read as "the pipeline ran, so it must
    // be fine" — this gate asks about exactly one stage.
    const { base, seed } = setup();
    const otherStage = designGateClosed(seed.id).map((record) => ({
      ...record,
      stage: "research" as const,
    }));
    await expect(
      transitionChangeSetToReady({ ...base, stageCompletions: otherStage }),
    ).rejects.toThrow(DesignGateNotClosedError);
  });

  it("checks the gate BEFORE sealing, so a refused transition leaves no seal", async () => {
    // The same ordering discipline the unmapped-requirement check already has: a
    // refusal must not leave a journal record implying the run was approved.
    const { base, changeSets, seed } = setup();
    await expect(transitionChangeSetToReady({ ...base, stageCompletions: [] })).rejects.toThrow(
      DesignGateNotClosedError,
    );
    expect(await findLatestCriteriaSeal(store, seed.id)).toBeUndefined();
    expect(changeSets.get(seed.id)?.state).toBe("awaiting_approval");
  });
});
