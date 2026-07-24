import { describe, expect, it } from "vitest";
import {
  HAND_AUTHORED_READ_SCENARIO,
  loadReadScenarioCassette,
  runScriptedReadScenario,
} from "./scripted-read-scenario.js";

/**
 * roadmap/18 §Exit criteria: "Fake-Jira/cassette parity proven: the
 * scripted scenario set replayed against both fake and recorded cassette
 * yields identical typed results." Work item 6 entry point: "the same
 * scripted scenario must produce identical typed results from the fake
 * and from cassette replay."
 */
describe("fake vs. cassette parity", () => {
  it("the hand-authored fake and the recorded JSON cassette drive the JiraResourceClient to byte-identical typed results", async () => {
    const fromFake = await runScriptedReadScenario(HAND_AUTHORED_READ_SCENARIO);
    const fromCassette = await runScriptedReadScenario(loadReadScenarioCassette());

    expect(fromCassette).toEqual(fromFake);
  });

  it("sanity: the cassette fixture actually resolves and is non-trivial", () => {
    const cassette = loadReadScenarioCassette();
    expect(cassette.responses.length).toBeGreaterThan(1);
    expect(cassette.responses).toEqual(HAND_AUTHORED_READ_SCENARIO.responses);
  });
});
