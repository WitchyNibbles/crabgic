/**
 * `./reports.ts` — the two shapes every human-mode command surface reduces to.
 *
 * These exist because the alternative was ten call sites each hand-rolling
 * `lines.join("\n")`, which is exactly how `doctor` grew a ten-line
 * undifferentiated block while `docs/presentation-policy.md` sat in the repo
 * describing why that must not happen. A shared pair of builders is what makes
 * the policy the default rather than something each handler has to remember.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_POLICY } from "./presentation-policy.js";
import { stripAnsi } from "./colors.js";
import { CLI_TEXT, pluralize, renderItemListReport, renderResultLine } from "./reports.js";

describe("pluralize", () => {
  it("agrees with the count", () => {
    expect(pluralize(1, "run")).toBe("1 run");
    expect(pluralize(0, "run")).toBe("0 runs");
    expect(pluralize(3, "run")).toBe("3 runs");
  });

  it("takes an irregular plural", () => {
    expect(pluralize(2, "entry", "entries")).toBe("2 entries");
    expect(pluralize(1, "entry", "entries")).toBe("1 entry");
  });
});

describe("renderResultLine", () => {
  it("carries the role's glyph and exactly one trailing newline", () => {
    expect(renderResultLine("ok", "resumed")).toBe("✓ resumed\n");
  });

  it("renders a refusal distinctly from a success", () => {
    expect(renderResultLine("fail", "x")).not.toBe(renderResultLine("ok", "x"));
  });

  it("stays a single line — a one-fact result never becomes a report", () => {
    expect(renderResultLine("ok", "done").trimEnd().split("\n")).toHaveLength(1);
  });
});

describe("renderItemListReport", () => {
  const { sectionMaxBullets, bulletMaxWords } = DEFAULT_PRESENTATION_POLICY.limits;

  it("leads with the count, before any item", () => {
    const rendered = renderItemListReport({
      role: "info",
      lead: "2 runs.",
      title: "Runs",
      items: ["alpha", "beta"],
    });
    expect(rendered.indexOf("2 runs.")).toBeLessThan(rendered.indexOf("alpha"));
  });

  it("heads the section so the list is findable", () => {
    const rendered = renderItemListReport({
      role: "info",
      lead: "1 run.",
      title: "Runs",
      items: ["alpha"],
    });
    expect(rendered).toContain("Runs\n────");
  });

  it("caps a long list and announces the shortfall", () => {
    const items = Array.from({ length: sectionMaxBullets + 4 }, (_u, i) => `item${String(i)}`);
    const rendered = renderItemListReport({
      role: "info",
      lead: `${String(items.length)} things.`,
      title: "Things",
      items,
    });
    expect(rendered).not.toContain(`item${String(sectionMaxBullets)}`);
    expect(rendered).toContain("4 more");
    expect(rendered).toContain("--json");
  });

  it("elides an over-long item rather than emitting an unscannable line", () => {
    const long = Array.from({ length: bulletMaxWords + 6 }, (_u, i) => `w${String(i)}`).join(" ");
    const rendered = renderItemListReport({
      role: "info",
      lead: "1 thing.",
      title: "Things",
      items: [long],
    });
    expect(rendered).toContain("…");
    expect(rendered).not.toContain(`w${String(bulletMaxWords)}`);
  });

  it("keeps colour additive — the load-bearing accessibility invariant", () => {
    const input = {
      role: "info" as const,
      lead: "9 things.",
      title: "Things",
      items: Array.from({ length: sectionMaxBullets + 2 }, (_u, i) => `item${String(i)}`),
    };
    expect(stripAnsi(renderItemListReport(input, { profile: "text", color: true }))).toBe(
      renderItemListReport(input, CLI_TEXT),
    );
  });

  it("emits no trailing whitespace on any line", () => {
    const rendered = renderItemListReport({
      role: "info",
      lead: "1 thing.",
      title: "Things",
      items: ["a"],
    });
    for (const line of rendered.split("\n")) {
      expect(line).toBe(line.replace(/\s+$/, ""));
    }
  });
});
