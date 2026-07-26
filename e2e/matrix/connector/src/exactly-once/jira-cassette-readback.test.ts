/**
 * roadmap/23-release-hardening.md work item 6: "reuse ... 18[/19]'s ...
 * resource clients + their cassettes." Jira Cloud + Data Center read-back
 * evidence, driven through the REAL `JiraResourceClient` (both deployment
 * types) against the REAL, already-recorded cassette fixtures — never
 * hand-rolled JSON, never a reimplementation of the read path.
 *
 * NOTE per the owner's explicit phase-23 decision: Jira Data Center (19)
 * live-container conformance is CASSETTE-ONLY for this pass — 19's own DC
 * cassettes (`packages/connectors-jira/fixtures/datacenter/{10.3,11.3}/`)
 * are the DC evidence for this matrix; no DC live container is started or
 * required here.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HAND_AUTHORED_READ_SCENARIO,
  runScriptedReadScenario,
  runDatacenterScriptedReadScenario,
} from "@crabgic/connectors-jira";
import type { FakeProviderScript } from "@crabgic/gateway";
import {
  CONNECTOR_MATRIX_GATE_TAG,
  createScenarioJournal,
  emitScenarioEvidence,
} from "../support/evidence.js";
import type { ScenarioJournal } from "../support/evidence.js";

/**
 * DISCOVERED GAP (documented, not patched — packages/* is out of this
 * harness's confined edit scope): `@crabgic/connectors-jira`'s own exported
 * `loadReadScenarioCassette`/`loadDatacenterReadScenarioCassette`
 * (`packages/connectors-jira/src/testkit/scripted-read-scenario{,-dc}.ts`)
 * resolve their cassette JSON path relative to `import.meta.url` — correct
 * when that package's OWN test suite runs (vitest transforms its `.ts`
 * source directly, so `import.meta.url` stays under `src/`), but broken
 * for a genuine cross-package consumer like this harness: importing
 * `@crabgic/connectors-jira` resolves to its BUILT `dist/` output (this repo's
 * own npm-workspace convention — see this project's own `vitest.config.ts`
 * doc comment), and `tsc -b` never copies non-`.ts` assets (the cassette
 * `.json` files) into `dist/`, so the loader throws `ENOENT` there. Worked
 * around here by reading the exact same fixture bytes directly from their
 * known SOURCE path — the cassette DATA and the real `runScriptedReadScenario`/
 * `runDatacenterScriptedReadScenario` DRIVER (the actual `JiraResourceClient`
 * read path) are still 100% real and reused; only the broken loader
 * function itself is bypassed. Reported in this work item's final report.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const CONNECTORS_JIRA_SRC = join(HERE, "..", "..", "..", "..", "..", "packages", "connectors-jira");

function loadCloudCassetteFromSource(): FakeProviderScript {
  const raw = readFileSync(
    join(CONNECTORS_JIRA_SRC, "src", "testkit", "fixtures", "read-scenario.cassette.json"),
    "utf8",
  );
  return JSON.parse(raw) as FakeProviderScript;
}

function loadDatacenterCassetteFromSource(edition: "10.3" | "11.3"): FakeProviderScript {
  const raw = readFileSync(
    join(CONNECTORS_JIRA_SRC, "fixtures", "datacenter", edition, "read-scenario.cassette.json"),
    "utf8",
  );
  return JSON.parse(raw) as FakeProviderScript;
}

let tj: ScenarioJournal;

beforeEach(async () => {
  tj = await createScenarioJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

describe("Jira Cloud — real JiraResourceClient read-back against the real recorded cassette", () => {
  it("the byte-recorded cassette drives the real 7-call read scenario to fully-typed results", async () => {
    const cassette = loadCloudCassetteFromSource();
    const results = await runScriptedReadScenario(cassette);

    expect(results.projects).toBeTruthy();
    expect(results.boards).toBeTruthy();
    expect(results.sprints).toBeTruthy();
    expect(results.issue).toBeTruthy();
    expect(results.comments).toBeTruthy();
    expect(results.worklogs).toBeTruthy();

    await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: Jira Cloud cassette read-back — real JiraResourceClient over the recorded cassette",
      exitStatus: 0,
      outcomeContent: JSON.stringify(results),
    });
  });

  it("cassette/fake parity — the independently-maintained hand-authored script drives byte-identical results to the recorded cassette", async () => {
    const fromCassette = await runScriptedReadScenario(loadCloudCassetteFromSource());
    const fromFake = await runScriptedReadScenario(HAND_AUTHORED_READ_SCENARIO);
    expect(fromCassette).toEqual(fromFake);
  });
});

describe("Jira Data Center — CASSETTE-ONLY evidence (owner decision: no DC live container for this pass)", () => {
  it.each(["10.3", "11.3"] as const)(
    "DC %s: the real cassette drives the real DC JiraResourceClient (REST v2 + Agile) to fully-typed results",
    async (edition) => {
      const cassette = loadDatacenterCassetteFromSource(edition);
      const results = await runDatacenterScriptedReadScenario(cassette);

      expect(results.projects).toBeTruthy();
      expect(results.boards).toBeTruthy();
      expect(results.sprints).toBeTruthy();
      expect(results.issue).toBeTruthy();
      expect(results.comments).toBeTruthy();
      expect(results.worklogs).toBeTruthy();
    },
  );

  it("emits an EvidenceRecord tagged release-gate:connector-matrix confirming DC evidence is cassette-sourced, not a live container", async () => {
    const results10_3 = await runDatacenterScriptedReadScenario(
      loadDatacenterCassetteFromSource("10.3"),
    );
    const results11_3 = await runDatacenterScriptedReadScenario(
      loadDatacenterCassetteFromSource("11.3"),
    );

    const record = await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: Jira DC 10.3/11.3 — cassette-only evidence (owner decision: no live DC container this pass)",
      exitStatus: 0,
      outcomeContent: JSON.stringify({ results10_3, results11_3, evidenceSource: "cassette-only" }),
    });
    expect(record.gateTag).toBe(CONNECTOR_MATRIX_GATE_TAG);
  });
});
