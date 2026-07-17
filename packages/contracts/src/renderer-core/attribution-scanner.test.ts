import { describe, expect, it } from "vitest";
import { ATTRIBUTION_TOKENS, scanForAttributionTokens } from "./attribution-scanner.js";

describe("scanForAttributionTokens", () => {
  it("returns no findings for clean text", () => {
    expect(
      scanForAttributionTokens("fix(contracts): clamp pagination cursor to last valid page"),
    ).toEqual([]);
  });

  it("catches the seeded 'Generated with…' fixture (roadmap/02 Test plan)", () => {
    const text =
      "fix(contracts): clamp cursor\n\n🤖 Generated with Claude Code\nCo-Authored-By: Claude <noreply@anthropic.com>";
    const findings = scanForAttributionTokens(text);
    expect(findings.length).toBeGreaterThanOrEqual(3);
    expect(findings.some((f) => f.token === "Generated with")).toBe(true);
    expect(findings.some((f) => f.token === "Co-Authored-By")).toBe(true);
    expect(findings.some((f) => f.token === "🤖")).toBe(true);
  });

  it("is case-insensitive for text tokens", () => {
    expect(
      scanForAttributionTokens("GENERATED WITH a tool").some((f) => f.token === "Generated with"),
    ).toBe(true);
    expect(
      scanForAttributionTokens("co-authored-by: someone").some((f) => f.token === "Co-Authored-By"),
    ).toBe(true);
  });

  it("reports the correct index and 1-based line number", () => {
    const text = "line one\nGenerated with a tool";
    const findings = scanForAttributionTokens(text);
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding).toBeDefined();
    if (finding === undefined) {
      throw new Error("unreachable: length asserted above");
    }
    expect(finding.line).toBe(2);
    expect(text.slice(finding.index, finding.index + "Generated with".length).toLowerCase()).toBe(
      "generated with",
    );
  });

  it("finds multiple occurrences of the same token", () => {
    const text = "Generated with X\nGenerated with Y";
    const findings = scanForAttributionTokens(text).filter((f) => f.token === "Generated with");
    expect(findings).toHaveLength(2);
  });

  it("exposes the canonical token list", () => {
    expect(ATTRIBUTION_TOKENS).toEqual(["Generated with", "Co-Authored-By", "🤖"]);
  });

  it("findings are sorted by index ascending", () => {
    const text = "Co-Authored-By: x -- Generated with y";
    const findings = scanForAttributionTokens(text);
    const indices = findings.map((f) => f.index);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });
});
