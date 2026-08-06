import { createHash } from "node:crypto";
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
 *
 * ⚠️ HONESTY NOTE, added 2026-08-06 — matching the disclosure
 * `./fake-cassette-parity-dc.test.ts:16-22` already carries for Data
 * Center and `e2e/attestation/src/traceabilityEvidence.ts` for Grafana.
 * **`./fixtures/read-scenario.cassette.json` is HAND-AUTHORED, not
 * live-captured**: every one of its seven `bodyText` values is
 * byte-identical to `JSON.stringify` of the corresponding object literal
 * in `./scripted-read-scenario.ts`, and the file carries no capture
 * metadata of any kind — no timestamp, no request URLs, no response
 * headers, no instance identity. It was committed in the same commit as
 * the fake, with no capture tooling. So the two sides of this comparison
 * are NOT independently sourced, and this suite does **not** discharge
 * the exit criterion above; that box stays unticked and owner-gated on a
 * real recording against a licensed Jira Cloud sandbox. See
 * `docs/evidence/criteria-closeout/defects/18-cassette-parity-is-a-tautology.md`.
 *
 * What changed in the same pass, and why. This suite's second case used
 * to end with
 * `expect(cassette.responses).toEqual(HAND_AUTHORED_READ_SCENARIO.responses);`
 * — an assertion that PINNED the two sources to be element-wise equal at
 * rest. Because `runScriptedReadScenario` is a pure function of its
 * script, that made the parity assertion below unfalsifiable by
 * construction: equal inputs, equal outputs, forever. It is dropped. The
 * parity assertion is now the suite's only detector of fake/cassette
 * drift and can actually fail — measured in
 * `docs/evidence/phase-18/cassette-flow-replay-batchJ.txt` §P4. That
 * removes a false claim; it does not manufacture the missing recording.
 */
describe("fake vs. cassette parity", () => {
  it("the hand-authored fake and the JSON cassette fixture drive the JiraResourceClient to byte-identical typed results", async () => {
    const fromFake = await runScriptedReadScenario(HAND_AUTHORED_READ_SCENARIO);
    const fromCassette = await runScriptedReadScenario(loadReadScenarioCassette());

    expect(fromCassette).toEqual(fromFake);
  });

  it("sanity: the cassette fixture actually resolves and is non-trivial", () => {
    const cassette = loadReadScenarioCassette();
    expect(cassette.responses.length).toBeGreaterThan(1);
  });

  /**
   * Deliberate replacement for the byte-level coverage the dropped
   * `expect(cassette.responses).toEqual(HAND_AUTHORED_READ_SCENARIO.responses)`
   * used to provide. Dropping it without this would have been the
   * coverage-migration hazard in reverse: measured, a semantically
   * invisible key reorder inside one `bodyText` reddened ONLY that
   * assertion — the parity assertion above stayed green in both worlds
   * (`docs/evidence/phase-18/cassette-flow-replay-batchJ.txt` §P5).
   *
   * The difference that matters: the old assertion pinned the cassette
   * TO THE FAKE, which is what made parity unfalsifiable. This one pins
   * the cassette to ITSELF, so the cassette is free to diverge from the
   * fake — which is exactly what a parity assertion must be able to
   * detect — while still not drifting at the byte level unnoticed.
   * Hashing the parsed-and-restringified form, not the raw file, so
   * Prettier reformatting the fixture is not a false alarm while an edit
   * inside any `bodyText` string still is.
   *
   * When a real capture replaces this fixture, update the constant in the
   * same commit; a changed digest is meant to require a decision.
   */
  it("pins the cassette fixture's own bytes, so a byte-level edit cannot pass unnoticed", () => {
    const digest = createHash("sha256")
      .update(JSON.stringify(loadReadScenarioCassette()), "utf8")
      .digest("hex");
    expect(`sha256:${digest}`).toBe(
      "sha256:81e88334b8df1cb75ea1d8eef25d53e0ca8cf64a7702c0c20a54e8c10a44bb93",
    );
  });
});
