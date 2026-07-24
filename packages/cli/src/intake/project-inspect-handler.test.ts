import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { createChangeSetsRegistry } from "@eo/supervisor";
import { buildChangeSet } from "@eo/testkit";
import { runProjectInspectTool } from "./project-inspect-handler.js";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-cli-project-inspect-handler-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("runProjectInspectTool", () => {
  it("returns a valid partial report against an empty journal with no ChangeSets", async () => {
    const changeSets = createChangeSetsRegistry();
    const report = await runProjectInspectTool({}, { journal: store, changeSets });
    expect(report.changeSets).toEqual([]);
    expect(report.degraded.length).toBeGreaterThan(0);
  });

  it("scopes to one ChangeSet when changeSetId is supplied", async () => {
    const changeSets = createChangeSetsRegistry();
    const seed = buildChangeSet();
    changeSets.put(seed);
    const report = await runProjectInspectTool(
      { changeSetId: seed.id },
      { journal: store, changeSets },
    );
    expect(report.changeSets).toEqual([seed]);
  });
});
