import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@crabgic/contracts";
import { isArtifactKind, lint, toADF } from "@crabgic/renderer";
import { adfDocumentToWikiMarkup } from "./wiki-markup-render-profile.js";

/**
 * roadmap/19 exit criterion 4 — "`wikiMarkupRenderProfile` output passes
 * 17's blocking-artifact-lint corpus — golden-file diff test, zero
 * exceptions."
 *
 * Both substantive conjuncts live here, and neither had a bearer before.
 * Measured at the time this file was written: all three `lint()` calls in
 * `wiki-markup-render-profile.test.ts` (`:105`, `:168`, `:389`) lint the
 * INPUT candidate and then convert, so nothing anywhere ran converter
 * OUTPUT through the lint pipeline; and the "golden corpus" that suite
 * names is a 7-item array of hand-written markdown in the file itself,
 * not a diffed golden file.
 *
 * What this suite adds:
 *
 * 1. **Corpus, not a hand-written array.** The source is 17's own
 *    `packages/renderer/fixtures/corpus/`, which is what 19's criterion
 *    names ("17's blocking-artifact-lint corpus").
 * 2. **Output-side lint.** Every `expect: "ok"` fixture must still lint
 *    clean after the markdown -> ADF -> wiki-markup round trip, and every
 *    `expect: "blocked"` fixture must still fail lint — a serializer that
 *    launders an attack is exactly what an output-side assertion catches
 *    and an input-side one cannot.
 * 3. **Golden-file diff.** Converted output is diffed byte-for-byte
 *    against `../../../fixtures/wiki-golden/<id>.wiki`, so a change in the
 *    serializer's output shows up as a reviewable diff rather than as a
 *    still-green `toContain`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(HERE, "..", "..", "..", "..", "renderer", "fixtures", "corpus");
const GOLDEN_DIR = join(HERE, "..", "..", "..", "fixtures", "wiki-golden");

interface CorpusFixture {
  readonly id: string;
  readonly description: string;
  readonly kind: string;
  readonly candidate: string;
  readonly expect: "ok" | "blocked";
}

function loadCorpus(): readonly CorpusFixture[] {
  return readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(CORPUS_DIR, name), "utf8")) as CorpusFixture)
    .sort((a, b) => a.id.localeCompare(b.id));
}

const corpus = loadCorpus();

/**
 * The one fixture whose blocked status the ADF round trip legitimately does
 * not preserve, pinned as an assertion rather than described in prose.
 *
 * `toADF` has no image node — `ADF_ALLOWED_NODE_TYPES` deliberately excludes
 * `media*`, and that module's own doc comment states that an unrecognized
 * construct "degrades to a plain paragraph/text node rather than ever being
 * converted to a disallowed node type". So `![alt](url)` reaches the
 * serializer as literal `!` text plus an ordinary link mark, and the output
 * is a link: no longer an embedded remote image, and therefore no longer
 * blocked.
 *
 * This is a DESIGNED downgrade, not laundering — the construct the policy
 * forbids is genuinely absent from the output, which the assertion below
 * checks directly rather than inferring from the clean lint. Phase 17's own
 * `toWikiMarkup` takes the opposite route for the same input: it emits
 * `!url!` and stays blocked. If anyone later teaches `toADF` to carry images
 * through, this test reddens and the decision gets made deliberately.
 */
const ADF_NEUTRALIZED_FIXTURE_ID = "attack-remote-image";

describe("adfDocumentToWikiMarkup against 17's blocking-artifact-lint corpus", () => {
  // Anti-vacuity floor, mirroring `packages/renderer/src/corpus.test.ts`'s
  // own: a loader that silently reads nothing must fail loudly rather than
  // certify an absence.
  it("loads the full corpus, not an empty or truncated glob", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(21);
    expect(corpus.filter((f) => f.expect === "ok").length).toBeGreaterThanOrEqual(8);
    expect(corpus.filter((f) => f.expect === "blocked").length).toBeGreaterThanOrEqual(13);
  });

  for (const fixture of corpus.filter((f) => f.expect === "ok")) {
    it(`does not introduce a violation into clean text: ${fixture.id}`, () => {
      expect(isArtifactKind(fixture.kind)).toBe(true);
      if (!isArtifactKind(fixture.kind)) return;
      const converted = adfDocumentToWikiMarkup(toADF(fixture.candidate));
      expect(lint(converted, fixture.kind, DEFAULT_COMMUNICATION_POLICY)).toEqual({ ok: true });
    });
  }

  for (const fixture of corpus.filter(
    (f) => f.expect === "blocked" && f.id !== ADF_NEUTRALIZED_FIXTURE_ID,
  )) {
    it(`does not launder a blocked artifact: ${fixture.id}`, () => {
      expect(isArtifactKind(fixture.kind)).toBe(true);
      if (!isArtifactKind(fixture.kind)) return;
      const converted = adfDocumentToWikiMarkup(toADF(fixture.candidate));
      expect(lint(converted, fixture.kind, DEFAULT_COMMUNICATION_POLICY).ok).toBe(false);
    });
  }

  it(`neutralizes rather than carries the one non-ADF-representable attack: ${ADF_NEUTRALIZED_FIXTURE_ID}`, () => {
    const fixture = corpus.find((f) => f.id === ADF_NEUTRALIZED_FIXTURE_ID);
    expect(fixture).toBeDefined();
    if (!fixture || !isArtifactKind(fixture.kind)) return;

    // The input is blocked as authored...
    expect(lint(fixture.candidate, fixture.kind, DEFAULT_COMMUNICATION_POLICY).ok).toBe(false);

    const converted = adfDocumentToWikiMarkup(toADF(fixture.candidate));

    // ...and the output is clean because the image construct is GONE, in
    // both notations — not because a stage failed to look for it.
    expect(converted).not.toMatch(/!\[[^\]]*]\([^)]+\)/);
    expect(converted).not.toMatch(/!(?:https?:\/\/|[^\s!|]+\.(?:png|jpe?g|gif|svg))[^\s!]*!/i);
    expect(converted).toContain("[screenshot|https://evil.example/x.png]");
    expect(lint(converted, fixture.kind, DEFAULT_COMMUNICATION_POLICY)).toEqual({ ok: true });
  });
});

/**
 * Secret sentinels are REDACTED on both sides of the golden diff, never
 * committed.
 *
 * Several corpus fixtures are secret-shaped by design (`attack-secret-*`),
 * and the converted output reproduces the sentinel verbatim — which is the
 * correct behaviour for a format converter, and exactly what the repo's
 * pre-commit secret scan blocks on a newly added file. The established
 * ruling here is to assemble rather than bypass, so the same technique is
 * applied one level down: the golden holds `<<redacted:NAME>>`, the actual
 * output is passed through the identical redaction before comparison, and
 * the diff stays byte-for-byte everywhere else.
 *
 * The patterns are the pre-commit hook's own, so a future secret-shaped
 * fixture cannot trip it either. `REDACTED_FIXTURE_IDS` below keeps this
 * from quietly becoming a hole: each listed fixture must actually produce a
 * redaction, so "the sentinel survived conversion" stays pinned even though
 * the sentinel itself is not in the repository twice.
 */
const SECRET_SENTINEL_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["openai-key", /sk-[A-Za-z0-9]{20,}/g],
  ["github-classic-token", /ghp_[A-Za-z0-9]{36}/g],
  ["github-fine-grained-token", /github_pat_[A-Za-z0-9_]{20,}/g],
  ["aws-access-key", /AKIA[0-9A-Z]{16}/g],
  ["private-key-block", /-----BEGIN (?:RSA|EC|OPENSSH|DSA|PRIVATE) KEY-----/g],
];

interface Redaction {
  readonly text: string;
  readonly applied: readonly string[];
}

function redactSecretSentinels(text: string): Redaction {
  const applied: string[] = [];
  let out = text;
  for (const [name, pattern] of SECRET_SENTINEL_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    if (re.test(out)) {
      applied.push(name);
      out = out.replace(new RegExp(pattern.source, pattern.flags), `<<redacted:${name}>>`);
    }
  }
  return { text: out, applied };
}

/** Fixtures whose converted output MUST still carry a sentinel to redact. */
const REDACTED_FIXTURE_IDS = ["attack-secret-aws-key", "attack-secret-github-fine-grained-pat"];

describe("adfDocumentToWikiMarkup golden-file diff over the corpus", () => {
  it("has a golden file for every corpus fixture and no orphans", () => {
    const goldens = readdirSync(GOLDEN_DIR)
      .filter((name) => name.endsWith(".wiki"))
      .map((name) => name.replace(/\.wiki$/, ""))
      .sort();
    expect(goldens).toEqual(corpus.map((f) => f.id));
  });

  for (const fixture of corpus) {
    it(`output matches its committed golden byte-for-byte: ${fixture.id}`, () => {
      const golden = readFileSync(join(GOLDEN_DIR, `${fixture.id}.wiki`), "utf8");
      const converted = redactSecretSentinels(adfDocumentToWikiMarkup(toADF(fixture.candidate)));
      expect(converted.text).toBe(golden);
      if (REDACTED_FIXTURE_IDS.includes(fixture.id)) {
        // Anti-vacuity: the redaction must have fired. Without this, deleting
        // the sentinel from the converter's output would still match a golden
        // that no longer contains it either.
        expect(converted.applied.length).toBeGreaterThan(0);
      }
    });
  }

  it("redacts a sentinel wherever one appears, and leaves ordinary text alone", () => {
    const withKey = redactSecretSentinels("Evidence: AKIA" + "ABCDEFGHIJKLMNOP" + " leaked");
    expect(withKey.applied).toEqual(["aws-access-key"]);
    expect(withKey.text).toBe("Evidence: <<redacted:aws-access-key>> leaked");

    const clean = redactSecretSentinels("Outcome: shipped\nValidation: none");
    expect(clean.applied).toEqual([]);
    expect(clean.text).toBe("Outcome: shipped\nValidation: none");
  });
});
