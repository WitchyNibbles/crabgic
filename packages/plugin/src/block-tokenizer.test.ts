import { describe, expect, it } from "vitest";
import {
  tokenizeBlocks,
  proseLinesOf,
  proseParagraphsOf,
  hasStructure,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore -- plain .mjs, loaded by the engine alongside the hook; no .d.ts by design.
} from "../hooks/lib/block-tokenizer.mjs";

interface Block {
  readonly kind: string;
  readonly text: string;
}
const kinds = (message: string): string[] =>
  (tokenizeBlocks(message) as Block[]).map((b) => b.kind);

/**
 * Each case below is a construct the previous line-regex classifier got wrong,
 * enumerated in `docs/design/format-gate-production.md` §L2. They are the whole
 * reason a stateful tokenizer replaced the regexes: in CommonMark whether a
 * line is prose depends on what preceded it, and a line-at-a-time classifier
 * has to guess. One of those guesses already cost a real false positive.
 */
describe("constructs the line-regex classifier got wrong", () => {
  it("treats a 4-space indented block as code, not prose", () => {
    const message = ["Here it is:", "", "    const a = 1;", "    const b = 2;"].join("\n");
    expect(kinds(message)).toEqual(["paragraph", "blank", "code", "code"]);
    expect(proseLinesOf(message)).toEqual(["Here it is:"]);
  });

  it("does not end a tilde fence on a backtick fence inside it", () => {
    const message = ["~~~", "```", "still code", "~~~", "after"].join("\n");
    expect(kinds(message)).toEqual(["code", "code", "code", "code", "paragraph"]);
  });

  it("does not end a fence on a SHORTER run of the same character", () => {
    const message = ["````", "```", "still code", "````", "after"].join("\n");
    expect(kinds(message)).toEqual(["code", "code", "code", "code", "paragraph"]);
  });

  it("treats a wrapped bullet's continuation line as list, not prose", () => {
    const message = ["- a bullet that", "  wraps onto another line", "- second"].join("\n");
    expect(kinds(message)).toEqual(["list", "list", "list"]);
    expect(proseLinesOf(message)).toEqual([]);
  });

  it("treats a lazy (unindented) continuation as list too", () => {
    const message = ["- a bullet that", "wraps with no indent"].join("\n");
    expect(kinds(message)).toEqual(["list", "list"]);
  });

  it("recognises a setext heading, retroactively promoting the line above it", () => {
    const message = ["Findings", "========", "", "text"].join("\n");
    expect(kinds(message)).toEqual(["heading", "heading", "blank", "paragraph"]);
    expect(hasStructure(message)).toBe(true);
  });

  it("does not mistake a thematic break for a setext underline", () => {
    const message = ["", "---", "text"].join("\n");
    expect(kinds(message)).toEqual(["blank", "break", "paragraph"]);
  });

  it("recognises a table WITHOUT leading pipes", () => {
    const message = ["a | b", "--- | ---", "1 | 2"].join("\n");
    expect(kinds(message).slice(1)).toEqual(["table", "paragraph"]);
    expect(hasStructure(message)).toBe(true);
  });

  it("treats an HTML block as structure, not prose", () => {
    expect(kinds("<details>\n<summary>x</summary>")).toEqual(["html", "html"]);
  });

  it("treats a link reference definition as not prose", () => {
    expect(kinds("[spec]: https://example.com/spec")).toEqual(["reference"]);
  });
});

describe("prose extraction", () => {
  it("joins consecutive prose lines into one paragraph", () => {
    expect(proseParagraphsOf("one line\nsecond line\n\nnew para")).toEqual([
      "one line second line",
      "new para",
    ]);
  });

  it("does not join across a fence", () => {
    expect(proseParagraphsOf("before\n```\ncode\n```\nafter")).toEqual(["before", "after"]);
  });

  it("returns nothing for a message that is entirely structure", () => {
    expect(proseParagraphsOf("## H\n\n- a\n- b")).toEqual([]);
  });

  it("is empty for an empty message", () => {
    expect(proseParagraphsOf("")).toEqual([]);
    expect(proseLinesOf("")).toEqual([]);
  });
});

describe("hasStructure", () => {
  it.each([
    ["## a heading", true],
    ["- a bullet", true],
    ["1. an ordered item", true],
    ["| a | table |", true],
    ["Setext\n------", true],
    ["just prose", false],
    ["```\ncode only\n```", false],
    ["> a quote", false],
  ])("%s → %s", (message, expected) => {
    expect(hasStructure(message)).toBe(expected);
  });

  /**
   * Code and quotes deliberately do NOT count as structure. Neither gives a
   * reader a place to land: a fenced block is one opaque object, and a quote is
   * someone else's words. A message that is nothing but a code block is not a
   * wall either — which is why the gate's threshold is measured over prose
   * lines, and this only reports what navigation exists.
   */
  it("does not count code or quotes as navigational structure", () => {
    expect(hasStructure("```\nx\n```")).toBe(false);
    expect(hasStructure("> quoted")).toBe(false);
  });
});
