/**
 * `fake-live-parity.test` (roadmap/06 exit criterion: "Fake-vs-live parity:
 * identical fixture verdicts across `packages/testkit`'s fake engine and the
 * real engine"). OFFLINE and deterministic — runs in the DEFAULT gate, never
 * spawns an engine. It evaluates the same 7 `CONFORMANCE_FIXTURES` through
 * testkit's fake layered-conformance evaluator and asserts verdict-for-
 * verdict equality with the COMMITTED `src/live/fixtures/live-verdicts.json`.
 *
 * HONEST CURRENT STATE: the committed file's `source` is presently
 * `"offline-baseline"` — it was generated deterministically OFFLINE by
 * `live-harness.ts`'s `deriveOfflineBaselineVerdicts` (fixture-expected
 * verdict + `classifyFixtureDenyMechanism`'s static classification), NOT
 * observed from a real engine run. So today this test is fake-vs-fake-
 * derived-baseline, not fake-vs-live — the parity claim is genuinely
 * circular until a green `@live` run (`npm run test:live` with `EO_LIVE=1`)
 * replaces the file with `source: "live"` real-engine observations. Only at
 * that point does this test become fake-vs-live in truth. The roadmap/06
 * "fake-vs-live parity" exit criterion therefore stays OPEN even though this
 * test is green — closing it requires a `source: "live"` committed file.
 *
 * This test still earns its keep in the interim: it goes RED whenever the
 * fake engine disagrees with the fixtures' own baseline-derived expected
 * verdict, or whenever `classifyFixtureDenyMechanism`'s static classification
 * (shared with the live suite) disagrees with the committed mechanism — a
 * corruption/regression guard that holds regardless of `source`.
 *
 * Parity is asserted at the OVERALL-verdict level (allow/deny). Per-layer
 * attribution (which of permissions/adjudication/sandbox denied) is the fake
 * engine's own concern, unit-tested in `packages/testkit`; the live half
 * (`envelope-conformance.live.test`) can only soundly observe the overall
 * outcome, so parity is defined over that shared observable. See
 * `envelope-conformance.live.test.ts`'s header for why the live run's two
 * enforcement mechanisms (adapter footgun-gate vs. engine permission layer)
 * both resolve to the same overall `deny` the fake engine computes.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONFORMANCE_FIXTURES, evaluateAllLayers, resolveConformanceFixture } from "@eo/testkit";
import type { AdjudicationCallback } from "@eo/engine-core";
import { classifyFixtureDenyMechanism } from "./live/live-harness.js";

// The fixtures' `expected.adjudication` is "allow" for all 7 (the fake
// evaluator's adjudication layer is isolated here so only permissions/sandbox
// decide the overall verdict), mirroring the live suite's allow-all adjudicate.
const allowAll: AdjudicationCallback = async (_toolName, toolInput) => ({
  behavior: "allow",
  updatedInput: toolInput,
});

interface LiveVerdictsFile {
  readonly engineVersion: string;
  readonly source: "live" | "offline-baseline";
  readonly fixtures: Readonly<
    Record<
      string,
      { readonly verdict: "allow" | "deny"; readonly mechanism: string; readonly detail: string }
    >
  >;
}

const LIVE_VERDICTS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "live",
  "fixtures",
  "live-verdicts.json",
);

const committed = JSON.parse(readFileSync(LIVE_VERDICTS_PATH, "utf8")) as LiveVerdictsFile;

function fixtureExpectedOverall(fixture: (typeof CONFORMANCE_FIXTURES)[number]): "allow" | "deny" {
  const { permissions, adjudication, sandbox } = fixture.expected;
  return permissions === "deny" || adjudication === "deny" || sandbox === "deny" ? "deny" : "allow";
}

describe("fake-live parity over the 7 conformance fixtures", () => {
  it("the committed live-verdicts fixture covers exactly the 7 conformance fixtures", () => {
    expect(Object.keys(committed.fixtures).sort()).toEqual(
      CONFORMANCE_FIXTURES.map((fixture) => fixture.name).sort(),
    );
  });

  for (const fixture of CONFORMANCE_FIXTURES) {
    it(`${fixture.name}: fake overall === committed live verdict === fixture expected overall`, async () => {
      const { profile, permissionRules } = resolveConformanceFixture(fixture);
      const fake = await evaluateAllLayers(profile, fixture.toolCall, allowAll, permissionRules);
      const live = committed.fixtures[fixture.name];
      expect(live, `no committed live verdict for ${fixture.name}`).toBeDefined();
      // Fake vs live must agree.
      expect(fake.overall).toBe(live?.verdict);
      // Both must agree with the fixture's own baseline-derived expected overall.
      expect(fake.overall).toBe(fixtureExpectedOverall(fixture));
      // Corruption/regression guard (F4): the committed mechanism must match
      // the shared static classifier — holds whether `source` is
      // "offline-baseline" or "live"-confirmed, since both are all-deny with
      // the same classification.
      expect(live?.mechanism).toBe(classifyFixtureDenyMechanism(fixture));
    });
  }
});
