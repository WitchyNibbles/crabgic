import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { IllegalTransitionError } from "@eo/contracts";
import { buildChangeSet } from "@eo/testkit";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import { ChangeSetNotFoundError, transitionChangeSet } from "./change-set-transition.js";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-supervisor-changeset-transition-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("transitionChangeSet", () => {
  it("journals run_transition and updates the ChangeSetsRegistry for a legal transition", async () => {
    const changeSets = createChangeSetsRegistry();
    const seed = buildChangeSet({ state: "draft" });
    changeSets.put(seed);

    const updated = await transitionChangeSet({
      journal: store,
      changeSets,
      changeSetId: seed.id,
      to: "awaiting_approval",
    });

    expect(updated.state).toBe("awaiting_approval");
    expect(changeSets.get(seed.id)?.state).toBe("awaiting_approval");

    const entries: unknown[] = [];
    for await (const entry of store.queryEntries({
      type: "run_transition",
      changeSetId: seed.id,
    })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
  });

  it("throws IllegalTransitionError (no journal write) for an illegal transition", async () => {
    const changeSets = createChangeSetsRegistry();
    const seed = buildChangeSet({ state: "draft" });
    changeSets.put(seed);

    await expect(
      transitionChangeSet({ journal: store, changeSets, changeSetId: seed.id, to: "running" }),
    ).rejects.toThrow(IllegalTransitionError);

    let count = 0;
    for await (const _entry of store.queryEntries({ type: "run_transition" })) count++;
    expect(count).toBe(0);
    expect(changeSets.get(seed.id)?.state).toBe("draft");
  });

  it("throws ChangeSetNotFoundError for an unknown id", async () => {
    const changeSets = createChangeSetsRegistry();
    await expect(
      transitionChangeSet({
        journal: store,
        changeSets,
        changeSetId: "99999999-9999-4999-8999-999999999999",
        to: "awaiting_approval",
      }),
    ).rejects.toThrow(ChangeSetNotFoundError);
  });
});
