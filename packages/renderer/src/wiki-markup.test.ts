import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@crabgic/contracts";
import { isArtifactKind } from "./artifact-kind.js";
import { lint } from "./lint.js";
import { unicodeDefenseStage } from "./unicode-defense.js";
import { BOLD_PLACEHOLDER_CLOSE, BOLD_PLACEHOLDER_OPEN, toWikiMarkup } from "./wiki-markup.js";

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

describe("the bold placeholders are unforgeable — pinned, not assumed", () => {
  // Added 2026-08-06. The bold pass tokenizes `**bold**` behind a sentinel so
  // the later italic pass cannot re-match its own output. The scheme is only
  // sound while NO source text reaching `toWikiMarkup` can contain the
  // sentinel — and what guarantees that is not this module. It is
  // `unicode-defense.ts`, one stage earlier, refusing U+0000 outright.
  //
  // Nothing asserted that cross-module dependency: rewriting the placeholders
  // to `@@WIKI_STRONG_OPEN@@` left gateway, learning and renderer green across
  // 74 files / 785 tests. That is a silent injection-surface regression — a
  // candidate containing the printable sentinel would come back with bold
  // markers it never wrote.
  const placeholders = { BOLD_PLACEHOLDER_OPEN, BOLD_PLACEHOLDER_CLOSE };

  for (const [name, placeholder] of Object.entries(placeholders)) {
    it(`${name} carries a codepoint the lint stage refuses`, () => {
      const findings = unicodeDefenseStage({
        candidate: placeholder,
        kind: "commit_body",
        policy: DEFAULT_COMMUNICATION_POLICY,
      });
      expect(findings.some((f) => /control character/i.test(f.message))).toBe(true);
    });
  }

  it("CONTROL: the same sentinel text WITHOUT its control characters is accepted", () => {
    // Without this, the assertions above would also pass for a stage that
    // rejected every candidate. This is the exact text a `@@`-style rewrite
    // would produce, and the stage lets it straight through — which is
    // precisely why such a rewrite would be silent.
    const printable = BOLD_PLACEHOLDER_OPEN.replaceAll("\0", "@@");
    expect(printable).toBe("@@WIKI_STRONG_OPEN@@");
    expect(
      unicodeDefenseStage({
        candidate: printable,
        kind: "commit_body",
        policy: DEFAULT_COMMUNICATION_POLICY,
      }),
    ).toEqual([]);
  });

  it("the placeholders never survive into converted output", () => {
    // The end-to-end half: whatever the sentinel is, it must be fully
    // reversed. Asserted on a real conversion rather than by inspection.
    const converted = toWikiMarkup("**bold** and *italic*");
    expect(converted).not.toContain("WIKI_STRONG_OPEN");
    expect(converted).not.toContain("WIKI_STRONG_CLOSE");
    expect(converted).toBe("*bold* and _italic_");
  });
});
