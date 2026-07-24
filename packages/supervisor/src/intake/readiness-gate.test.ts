import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { IllegalTransitionError } from "@eo/contracts";
import { buildChangeSet } from "@eo/testkit";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import { UnmappedRequirementError, transitionChangeSetToReady } from "./readiness-gate.js";

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
    });

    expect(updated.state).toBe("ready");
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
      }),
    ).rejects.toThrow(IllegalTransitionError);
  });
});
