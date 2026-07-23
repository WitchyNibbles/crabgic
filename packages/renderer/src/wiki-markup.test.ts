import { describe, expect, it } from "vitest";
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

  it("passes the same corpus subset toADF validates (roadmap/17 Test plan)", () => {
    const markdown = [
      "# Heading",
      "",
      "A paragraph with **bold**, *italic*, `code`, and [a link](https://example.com).",
      "",
      "- bullet one",
      "- bullet two",
    ].join("\n");
    const out = toWikiMarkup(markdown);
    expect(out).toContain("h1. Heading");
    expect(out).toContain("*bold*");
    expect(out).toContain("_italic_");
    expect(out).toContain("{{code}}");
    expect(out).toContain("[a link|https://example.com]");
    expect(out).toContain("* bullet one");
    expect(out).toContain("* bullet two");
  });
});
