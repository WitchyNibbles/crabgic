import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@crabgic/contracts";
import { isArtifactKind } from "./artifact-kind.js";
import { lint } from "./lint.js";
import { toWikiMarkup } from "./wiki-markup.js";

describe("toWikiMarkup", () => {
  it("converts a heading", () => {
    expect(toWikiMarkup("# Title")).toBe("h1. Title");
  });

  it("clamps heading level to 3", () => {
    expect(toWikiMarkup("###### Deep")).toBe("h3. Deep");
  });

  it("converts bold, italic, code, and link marks", () => {
    const out = toWikiMarkup(
      "plain **bold** and *italic* and `code` and [link](https://example.com)",
    );
    expect(out).toBe("plain *bold* and _italic_ and {{code}} and [link|https://example.com]");
  });

  it("leaves underscore-italic syntax unchanged (already wiki-compatible)", () => {
    expect(toWikiMarkup("an _italic_ word")).toBe("an _italic_ word");
  });

  it("converts a bullet list", () => {
    expect(toWikiMarkup("- one\n- two")).toBe("* one\n* two");
  });

  it("converts an ordered list", () => {
    expect(toWikiMarkup("1. one\n2. two")).toBe("# one\n# two");
  });

  it("converts a fenced code block", () => {
    expect(toWikiMarkup("```\nconst x = 1;\n```")).toBe("{code}\nconst x = 1;\n{code}");
  });

  it("converts a blockquote", () => {
    expect(toWikiMarkup("> quoted text")).toBe("bq. quoted text");
  });

  it("converts a markdown image to wiki image syntax, not to a link", () => {
    // A markdown image must stay an IMAGE across the conversion. Rewriting
    // it to `[alt|url]` would hand url-policy a construct it permits and
    // silently downgrade a blocked artifact to a clean one — see the corpus
    // suite below, which is what pins this end to end.
    expect(toWikiMarkup("![screenshot](https://example.com/x.png)")).toBe(
      "!https://example.com/x.png!",
    );
  });
});

/**
 * roadmap/17 exit criterion 5 — "`toWikiMarkup` output passes the same
 * corpus subset phase 19 names as its own exit criterion", where 19's box
 * names 17's blocking-artifact-lint corpus (`../fixtures/corpus/`).
 *
 * The bearer this replaces (`it("passes the same corpus subset toADF
 * validates")`) matched the criterion by NAME only: it asserted `toContain`
 * against a hand-written markdown string and never called `lint()`, never
 * loaded a fixture, and could not fail for any corpus reason. Measured
 * before the replacement landed: `git grep -nE "lint\(\s*toWikiMarkup"`
 * over `packages/` returned nothing — no test anywhere ran the converter's
 * OUTPUT through the lint pipeline.
 */
const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "corpus");

interface WikiCorpusFixture {
  readonly id: string;
  readonly description: string;
  readonly kind: string;
  readonly candidate: string;
  readonly expect: "ok" | "blocked";
}

function loadCorpus(): readonly WikiCorpusFixture[] {
  return readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(CORPUS_DIR, name), "utf8")) as WikiCorpusFixture)
    .sort((a, b) => a.id.localeCompare(b.id));
}

const corpus = loadCorpus();

describe("toWikiMarkup output against the phase-17 lint corpus", () => {
  // Anti-vacuity floor, mirroring `corpus.test.ts`'s own: a broken glob must
  // fail loudly rather than certify an absence by scanning nothing.
  it("loads the full corpus, not an empty or truncated glob", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(21);
    expect(corpus.filter((f) => f.expect === "ok").length).toBeGreaterThanOrEqual(8);
    expect(corpus.filter((f) => f.expect === "blocked").length).toBeGreaterThanOrEqual(13);
  });

  for (const fixture of corpus.filter((f) => f.expect === "ok")) {
    it(`does not introduce a violation into clean text: ${fixture.id}`, () => {
      expect(isArtifactKind(fixture.kind)).toBe(true);
      if (!isArtifactKind(fixture.kind)) return;
      const converted = toWikiMarkup(fixture.candidate);
      expect(lint(converted, fixture.kind, DEFAULT_COMMUNICATION_POLICY)).toEqual({ ok: true });
    });
  }

  for (const fixture of corpus.filter((f) => f.expect === "blocked")) {
    it(`does not launder a blocked artifact: ${fixture.id}`, () => {
      expect(isArtifactKind(fixture.kind)).toBe(true);
      if (!isArtifactKind(fixture.kind)) return;
      const converted = toWikiMarkup(fixture.candidate);
      expect(lint(converted, fixture.kind, DEFAULT_COMMUNICATION_POLICY).ok).toBe(false);
    });
  }
});
