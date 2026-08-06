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
 * circular until a green `@live` run (`npm run test:live` with `CRABGIC_LIVE=1`)
 * replaces the file with `source: "live"` real-engine observations. Only at
 * that point does this test become fake-vs-live in truth. The roadmap/06
 * "fake-vs-live parity" exit criterion therefore stays OPEN even though this
 * test is green — closing it requires a `source: "live"` committed file.
 *
 * ── CORRECTION 2026-08-06 (annotate, never rewrite: the paragraph above is
 * left verbatim and every sentence of it was true when written). Two of its
 * claims are now false, and the third was never the guarantee it reads as.
 *
 *  1. `source` has read `"live"` since commit `29b3c46`, not
 *     `"offline-baseline"`. Measured with
 *     `git show <rev>:packages/engine-claude/src/live/fixtures/live-verdicts.json`.
 *  2. The stated closing condition — "closing it requires a `source: "live"`
 *     committed file" — was satisfiable by EDITING ONE STRING, and had in fact
 *     been "satisfied" that way by `29b3c46`, a commit about wiring `learn-*`
 *     promotion, at a time when no green `@live` run had ever happened. A gate
 *     nobody can fail is not a gate.
 *  3. The criterion's real closing evidence is not the string at all: a green
 *     `@live` conformance run regenerated this file from real-engine
 *     observations and `git status --porcelain` on it came back EMPTY, digest
 *     still `ada6ddd1cc98cf10146a8c9629b6c95c` — the fake-derived bytes and the
 *     real-engine-derived bytes are identical. Recorded at
 *     `docs/evidence/phase-06/closeout/closeout-live-batch.txt` §4. The mtime,
 *     the green run and the clean diff are the provenance; the `source` string
 *     is not.
 *
 * Defect record `06-live-verdicts-source-label-not-provenance.md` holds the
 * full measurement. Its remedy landed with this correction:
 * `writeLiveVerdicts` now demands a `CanaryResult` witness of a real engine
 * invocation before it will stamp `"live"`, so the label can no longer be
 * minted by hand — see `live-harness.ts`'s `LiveVerdictsProvenance`.
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
import {
  CONFORMANCE_FIXTURES,
  evaluateAllLayers,
  resolveConformanceFixture,
} from "@crabgic/testkit";
import type { AdjudicationCallback } from "@crabgic/engine-core";
import {
  classifyFixtureDenyMechanism,
  deriveOfflineBaselineVerdicts,
} from "./live/live-harness.js";

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

  /**
   * `deriveOfflineBaselineVerdicts`'s FIRST call site anywhere in the
   * repository (defect record
   * `06-live-verdicts-source-label-not-provenance.md`, remedy item 2: "wire or
   * remove"). Until this case it had zero callers repo-wide while
   * `writeLiveVerdicts`'s doc comment named it as the source of an
   * `"offline-baseline"` payload — dead code cited as a mechanism, which is
   * how a control ends up trusted and inert. Wiring beat deleting because the
   * alternative removes `LiveVerdictsSource`'s second member and with it the
   * committed file's `source` field, i.e. it rewrites the very artifact the
   * parity criterion rests on.
   *
   * It is also a NEW pin, not a restatement of `:mechanism` below: the
   * committed `detail` strings were read by nothing before this, so
   * `ADAPTER_GATE_DETAIL`/`ENGINE_DENY_DETAIL` could drift away from the
   * committed file silently. The derivation additionally asserts all 7 fixtures
   * are overall-deny rather than assuming it.
   *
   * What this does NOT claim: that the committed bytes came from an engine.
   * That is the live suite's green-run guard plus the clean-diff regeneration
   * recorded in `docs/evidence/phase-06/closeout/closeout-live-batch.txt` §4.
   * What it does claim is the byte-reproducibility the derivation was written
   * for — the offline derivation and the committed file agree exactly, so
   * regenerating offline could not silently change the artifact.
   */
  it("the committed fixture equals `deriveOfflineBaselineVerdicts()` verdict, mechanism AND detail", () => {
    const derived = deriveOfflineBaselineVerdicts();
    expect([...derived.keys()].sort()).toEqual(Object.keys(committed.fixtures).sort());
    for (const [name, verdict] of derived) {
      expect(committed.fixtures[name], `no committed verdict for ${name}`).toEqual(verdict);
    }
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
