import { describe, expect, it } from "vitest";
import { FrontmatterParseError, parseFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses string, boolean, and array attributes plus the body", () => {
    const content = [
      "---",
      "name: approve",
      "description: Approves things",
      "disable-model-invocation: true",
      'tools: ["Read", "Grep"]',
      "---",
      "",
      "# Body",
      "text",
    ].join("\n");

    const result = parseFrontmatter(content);
    expect(result.attributes).toEqual({
      name: "approve",
      description: "Approves things",
      "disable-model-invocation": true,
      tools: ["Read", "Grep"],
    });
    expect(result.body).toBe("# Body\ntext");
  });

  it("strips a single layer of surrounding quotes from a string value", () => {
    const content = ["---", 'model: "sonnet"', "---", ""].join("\n");
    expect(parseFrontmatter(content).attributes.model).toBe("sonnet");
  });

  it("throws FrontmatterParseError when content does not start with a delimiter", () => {
    expect(() => parseFrontmatter("no frontmatter here")).toThrow(FrontmatterParseError);
  });

  it("throws FrontmatterParseError when the closing delimiter is missing", () => {
    expect(() => parseFrontmatter("---\nname: x\n")).toThrow(FrontmatterParseError);
  });

  it("throws FrontmatterParseError on a line with no colon", () => {
    expect(() => parseFrontmatter("---\nnotakeyvalue\n---\n")).toThrow(FrontmatterParseError);
  });

  it("tolerates blank lines inside the frontmatter block", () => {
    const content = ["---", "name: x", "", "description: y", "---", ""].join("\n");
    expect(parseFrontmatter(content).attributes).toEqual({ name: "x", description: "y" });
  });

  it("falls back to a raw string when a bracketed value is not a valid string array", () => {
    const content = ["---", "weird: [1, 2, 3]", "---", ""].join("\n");
    expect(parseFrontmatter(content).attributes.weird).toBe("[1, 2, 3]");
  });
});
