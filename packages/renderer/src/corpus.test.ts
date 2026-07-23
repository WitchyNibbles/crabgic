import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { lint } from "./lint.js";
import { isArtifactKind } from "./artifact-kind.js";

/**
 * Golden + property corpus harness — roadmap/17 work item 9: "wired as a CI
 * job (`renderer-corpus`) that 23 re-invokes directly rather than
 * re-deriving its own copy." This `vitest run packages/renderer` invocation
 * (via the root `npm test` / this repo's CI) IS that job — 23's own
 * "Neutral communication" E2E bullet re-executes this exact suite, not a
 * forked copy, against `packages/renderer/fixtures/corpus/`.
 *
 * Aggregation gate (work item 9's failing-first requirement): this harness
 * fails to run meaningfully until every prior stage exists — every fixture
 * below exercises the FULL `STAGE_PIPELINE`, so a missing/broken stage
 * shows up here even if that stage's own unit suite was (hypothetically)
 * skipped.
 */

const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "corpus");

interface CorpusFixture {
  readonly id: string;
  readonly description: string;
  readonly kind: string;
  readonly candidate: string;
  readonly expect: "ok" | "blocked";
  readonly expectedStages?: readonly string[];
}

function loadFixtures(): readonly CorpusFixture[] {
  return readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(CORPUS_DIR, name), "utf8")) as CorpusFixture)
    .sort((a, b) => a.id.localeCompare(b.id));
}

const fixtures = loadFixtures();

describe("renderer corpus — packages/renderer/fixtures/corpus/", () => {
  it("loads at least one attack fixture per named vector and one valid fixture per ArtifactKind", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(21);
    const validKinds = new Set(fixtures.filter((f) => f.expect === "ok").map((f) => f.kind));
    expect(validKinds.size).toBe(8);
  });

  for (const fixture of fixtures) {
    it(`${fixture.id}: ${fixture.description}`, () => {
      expect(isArtifactKind(fixture.kind)).toBe(true);
      if (!isArtifactKind(fixture.kind)) return;

      const outcome = lint(fixture.candidate, fixture.kind, DEFAULT_COMMUNICATION_POLICY);

      if (fixture.expect === "ok") {
        expect(outcome).toEqual({ ok: true });
      } else {
        expect(outcome.ok).toBe(false);
        if (!outcome.ok && fixture.expectedStages) {
          const stages = new Set(outcome.findings.map((f) => f.stage));
          for (const expectedStage of fixture.expectedStages) {
            expect(stages.has(expectedStage)).toBe(true);
          }
        }
      }
    });
  }
});
