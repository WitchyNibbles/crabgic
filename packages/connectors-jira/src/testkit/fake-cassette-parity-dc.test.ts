import { describe, expect, it } from "vitest";
import {
  buildDatacenterHandAuthoredScenario,
  loadDatacenterReadScenarioCassette,
  runDatacenterScriptedReadScenario,
} from "./scripted-read-scenario-dc.js";

/**
 * Data Center equivalent of `./fake-cassette-parity.test.ts` — roadmap/19-
 * jira-datacenter-adapter.md §Test plan: "cassette replay against 10.3
 * and 11.3 recordings." Proves the hand-authored fake and EACH recorded
 * per-edition cassette drive this connector's REAL DC `JiraResourceClient`
 * to byte-identical typed results — same parity discipline 18 established
 * for Cloud, run for both fixture versions this phase names.
 *
 * Honesty note (matching phase 20's Grafana precedent): these cassettes
 * are hand-authored/MODELED fixtures reflecting Jira Data Center's
 * documented REST v2/Agile response shapes, not live-captured recordings
 * against a running 10.3/11.3 instance — no live DC license was available
 * in this environment. `docker/jira-datacenter/{10.3,11.3}/` provides the
 * container recipes a future live-capture pass (or 23's release-hardening
 * work) would use to replace these with byte-recorded traffic.
 */
describe.each(["10.3", "11.3"] as const)("fake vs. cassette parity — DC edition %s", (edition) => {
  it("the hand-authored fake and the recorded per-edition cassette drive the DC JiraResourceClient to byte-identical typed results", async () => {
    const fromFake = await runDatacenterScriptedReadScenario(buildDatacenterHandAuthoredScenario());
    const fromCassette = await runDatacenterScriptedReadScenario(
      loadDatacenterReadScenarioCassette(edition),
    );
    expect(fromCassette).toEqual(fromFake);
  });

  it("sanity: the cassette fixture actually resolves and is non-trivial", () => {
    const cassette = loadDatacenterReadScenarioCassette(edition);
    expect(cassette.responses.length).toBeGreaterThan(1);
    expect(cassette.responses).toEqual(buildDatacenterHandAuthoredScenario().responses);
  });
});
