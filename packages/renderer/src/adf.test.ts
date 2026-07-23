import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import {
  ADF_ALLOWED_MARK_TYPES,
  ADF_ALLOWED_NODE_TYPES,
  adfSafeSubsetStage,
  toADF,
  validateAdfSafeSubset,
  type AdfDocument,
} from "./adf.js";
import type { LintStageInput } from "./lint-types.js";

describe("validateAdfSafeSubset", () => {
  it("rejects a disallowed ADF node (e.g. layoutSection) — failing-first fixture, work item 5", () => {
    const doc: AdfDocument = {
      type: "doc",
      version: 1,
      content: [{ type: "layoutSection", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }],
    };
    const findings = validateAdfSafeSubset(doc);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.message).toMatch(/layoutSection.*not in the safe-subset whitelist/);
  });

  it("rejects a disallowed mark type", () => {
    const doc: AdfDocument = {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "mention" }] }] }],
    };
    const findings = validateAdfSafeSubset(doc);
    expect(findings.some((f) => f.message.match(/mark type "mention"/))).toBe(true);
  });

  it("rejects a link mark with a javascript: href — M2 adversarial-review fixture", () => {
    const doc: AdfDocument = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
        },
      ],
    };
    const findings = validateAdfSafeSubset(doc);
    expect(findings.some((f) => f.message.match(/href/i) && f.message.match(/javascript/i))).toBe(true);
  });

  it("rejects a link mark with a data: href", () => {
    const doc: AdfDocument = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "img", marks: [{ type: "link", attrs: { href: "data:text/html;base64,abcd" } }] },
          ],
        },
      ],
    };
    const findings = validateAdfSafeSubset(doc);
    expect(findings.some((f) => f.message.match(/href/i))).toBe(true);
  });

  it("rejects a link mark with a non-allowlisted scheme (plain http)", () => {
    const doc: AdfDocument = {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "http://example.com" } }] }] },
      ],
    };
    expect(validateAdfSafeSubset(doc).some((f) => f.message.match(/href/i))).toBe(true);
  });

  it("rejects a link mark with a missing/non-string href", () => {
    const doc: AdfDocument = {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link" }] }] }],
    };
    expect(validateAdfSafeSubset(doc).some((f) => f.message.match(/href/i))).toBe(true);
  });

  it("accepts a link mark with a safe https: href", () => {
    const doc: AdfDocument = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }],
        },
      ],
    };
    expect(validateAdfSafeSubset(doc)).toEqual([]);
  });

  it("accepts a doc built entirely from whitelisted nodes/marks", () => {
    const doc: AdfDocument = {
      type: "doc",
      version: 1,
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "strong" }] },
            { type: "text", text: " and " },
            { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
          ],
        },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }] }],
        },
      ],
    };
    expect(validateAdfSafeSubset(doc)).toEqual([]);
  });
});

describe("toADF", () => {
  it("converts a heading", () => {
    const doc = toADF("# Title");
    expect(doc.content[0]).toEqual({
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Title" }],
    });
  });

  it("clamps heading level to 3", () => {
    const doc = toADF("###### Deep title");
    expect(doc.content[0]!.attrs?.["level"]).toBe(3);
  });

  it("converts a paragraph with bold/italic/code/link marks", () => {
    const doc = toADF("plain **bold** and *italic* and `code` and [link](https://example.com)");
    expect(validateAdfSafeSubset(doc)).toEqual([]);
    const paragraph = doc.content[0]!;
    expect(paragraph.type).toBe("paragraph");
    const texts = paragraph.content!.map((n) => n.text);
    expect(texts).toContain("bold");
    expect(texts).toContain("italic");
    expect(texts).toContain("code");
    expect(texts).toContain("link");
  });

  it("converts a bullet list", () => {
    const doc = toADF("- one\n- two");
    expect(doc.content[0]!.type).toBe("bulletList");
    expect(doc.content[0]!.content!.length).toBe(2);
  });

  it("converts an ordered list", () => {
    const doc = toADF("1. one\n2. two");
    expect(doc.content[0]!.type).toBe("orderedList");
    expect(doc.content[0]!.content!.length).toBe(2);
  });

  it("converts a fenced code block", () => {
    const doc = toADF("```\nconst x = 1;\n```");
    expect(doc.content[0]).toEqual({ type: "codeBlock", content: [{ type: "text", text: "const x = 1;" }] });
  });

  it("converts a blockquote", () => {
    const doc = toADF("> quoted text");
    expect(doc.content[0]!.type).toBe("blockquote");
  });

  it("never emits a disallowed node/mark for any fixture, across the whole whitelist", () => {
    const markdown = [
      "# Heading",
      "",
      "A paragraph with **bold**, *italic*, `code`, and [a link](https://example.com).",
      "",
      "- bullet one",
      "- bullet two",
      "",
      "1. ordered one",
      "2. ordered two",
      "",
      "> a quote",
      "",
      "```",
      "code block content",
      "```",
    ].join("\n");
    const doc = toADF(markdown);
    expect(validateAdfSafeSubset(doc)).toEqual([]);
  });

  it("degrades an unrecognized construct (a markdown table) to a plain paragraph, never a table node", () => {
    const doc = toADF("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(validateAdfSafeSubset(doc)).toEqual([]);
    expect(doc.content.every((node) => !node.type.startsWith("table"))).toBe(true);
  });
});

describe("ADF_ALLOWED_NODE_TYPES / ADF_ALLOWED_MARK_TYPES", () => {
  it("matches roadmap/17's exact whitelist", () => {
    expect(ADF_ALLOWED_NODE_TYPES).toEqual([
      "doc",
      "paragraph",
      "text",
      "heading",
      "bulletList",
      "orderedList",
      "listItem",
      "codeBlock",
      "blockquote",
      "hardBreak",
    ]);
    expect(ADF_ALLOWED_MARK_TYPES).toEqual(["link", "strong", "em", "code"]);
  });
});

describe("adfSafeSubsetStage", () => {
  function stageInput(candidate: string, kind: LintStageInput["kind"]): LintStageInput {
    return { candidate, kind, policy: DEFAULT_COMMUNICATION_POLICY };
  }

  it("is a no-op for non-Jira kinds", () => {
    expect(adfSafeSubsetStage(stageInput("anything at all", "commit_body"))).toEqual([]);
  });

  it("passes clean jira_milestone_comment markdown", () => {
    const text = "Outcome: done\nEvidence: https://example.com\nRisk: none\nNext: ship\nRef: PROJ-1";
    expect(adfSafeSubsetStage(stageInput(text, "jira_milestone_comment"))).toEqual([]);
  });
});
