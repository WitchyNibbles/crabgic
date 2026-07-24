import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { isArtifactKind, lint } from "@eo/renderer";

/**
 * roadmap/08-integration-publication.md §Test plan (Conformance): "reuse
 * (not fork) of 17's seeded 'Generated with…'/'Co-Authored-By' fixture."
 * §Exit criteria: "Golden/property rendering tests pass incl. Unicode/
 * length edges, asserted against 17's shared corpus rather than a forked
 * copy." §Interfaces produced: "Shared attribution-leak fixture — the
 * seeded 'Generated with…'/'Co-Authored-By' fixture is the SAME fixture
 * 17's work item 4 uses, asserted from both sides; 08 does not fork a
 * duplicate copy."
 *
 * This suite reads `packages/renderer/fixtures/corpus/` directly (the same
 * files `packages/renderer/src/corpus.test.ts` reads) rather than embedding
 * any copy of their content — a change to 17's corpus is picked up here
 * automatically, with zero duplication. Scoped to the 6 `ArtifactKind`
 * members roadmap/08 owns as caller (`branch_name`, `commit_subject`,
 * `commit_body`, `pr_title`, `pr_body`, `review_comment`) — `jira_
 * milestone_comment`/`grafana_annotation` fixtures are 18/20's concern, not
 * asserted from this side.
 */

const CORPUS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "renderer",
  "fixtures",
  "corpus",
);

interface CorpusFixture {
  readonly id: string;
  readonly description: string;
  readonly kind: string;
  readonly candidate: string;
  readonly expect: "ok" | "blocked";
  readonly expectedStages?: readonly string[];
}

const PHASE_08_ARTIFACT_KINDS = new Set([
  "branch_name",
  "commit_subject",
  "commit_body",
  "pr_title",
  "pr_body",
  "review_comment",
]);

function loadFixtures(): readonly CorpusFixture[] {
  return readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(CORPUS_DIR, name), "utf8")) as CorpusFixture)
    .filter((fixture) => PHASE_08_ARTIFACT_KINDS.has(fixture.kind))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const fixtures = loadFixtures();

describe("17's shared renderer corpus, reused (not forked) for 08's own 6 ArtifactKinds", () => {
  it("this suite actually found fixtures for at least one of 08's kinds (sanity guard against an empty/broken path)", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it("the seeded attribution-leak fixture is present and scoped to commit_body — the exact fixture this phase's own belt-and-suspenders assertion reuses", () => {
    const attributionFixture = fixtures.find((f) => f.id === "attack-attribution-leak");
    expect(attributionFixture).toBeDefined();
    expect(attributionFixture?.candidate).toContain("Generated with");
    expect(attributionFixture?.candidate).toContain("Co-Authored-By");
  });

  for (const fixture of fixtures) {
    it(`${fixture.id} (${fixture.kind}): ${fixture.description}`, () => {
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
