import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_POLICY } from "./presentation-policy.js";
import { displayWidth } from "../renderer-core/display-width.js";
import { renderMarkdownReport } from "./markdown-report.js";

const LIMITS = DEFAULT_PRESENTATION_POLICY.limits;

/**
 * The manager channel's renderer. It is NOT `renderHumanReport`, and the
 * separation is the point: `docs/presentation-policy.md` gives the two channels
 * opposite contrast mechanisms — SGR codes and box-drawing for a real terminal,
 * `**bold**` and `##` for a markdown TUI that cannot emit ANSI. Sharing the
 * renderer would have put `────────` underlines into a surface that renders
 * headings properly.
 *
 * What IS shared is the part that matters: the limits, and their enforcement.
 */
describe("renderMarkdownReport", () => {
  it("leads with the answer, bolded, before any section", () => {
    const out = renderMarkdownReport({
      lead: "3 gates passed, 1 failed.",
      sections: [{ title: "Failed", bullets: ["lint"] }],
    });
    expect(out.startsWith("**3 gates passed, 1 failed.**")).toBe(true);
    expect(out.indexOf("3 gates passed")).toBeLessThan(out.indexOf("## Failed"));
  });

  it("emits markdown structure, never the CLI's box-drawing rules", () => {
    const out = renderMarkdownReport({ lead: "x", sections: [{ title: "Risk", bullets: ["a"] }] });
    expect(out).toContain("## Risk");
    expect(out).not.toContain("─");
    // ANSI must never reach this channel; the TUI would render the escapes.
    expect(out).not.toMatch(/\[/);
  });

  it("carries the verdict as the vocabulary's emoji glyph", () => {
    expect(renderMarkdownReport({ role: "fail", lead: "2 failed." })).toContain("❌");
    expect(renderMarkdownReport({ role: "ok", lead: "all passed." })).toContain("✅");
  });

  it("puts the single next action last, where a reader looks for it", () => {
    const out = renderMarkdownReport({
      lead: "Done.",
      sections: [{ title: "S", bullets: ["a"] }],
      nextAction: "rerun the gate",
    });
    expect(out.trimEnd().endsWith("**Next:** rerun the gate")).toBe(true);
  });

  it("renders a table with a header rule", () => {
    const out = renderMarkdownReport({
      lead: "x",
      sections: [{ title: "S", table: { headers: ["id", "state"], rows: [["a", "ok"]] } }],
    });
    expect(out).toContain("| id | state |");
    expect(out).toContain("| --- | --- |");
    expect(out).toContain("| a | ok |");
  });

  it("escapes a pipe inside a cell, so one value cannot forge a column", () => {
    const out = renderMarkdownReport({
      lead: "x",
      sections: [{ title: "S", table: { headers: ["h"], rows: [["a | b"]] } }],
    });
    expect(out).toContain("a \\| b");
  });
});

/**
 * Prose throws, data degrades — the same split `renderHumanReport` enforces,
 * and for the same reason. An author typed the lead and the body, so a wall
 * there is a programming error worth failing loudly on. Bullets and table rows
 * are data whose size is unknown when the call site is written.
 */
describe("the limits are enforced here too", () => {
  it("throws on an over-long lead", () => {
    const lead = Array.from(
      { length: LIMITS.leadAnswerMaxLines + 1 },
      (_u, i) => `l${String(i)}`,
    ).join("\n");
    expect(() => renderMarkdownReport({ lead })).toThrow(/lead/i);
  });

  it("throws on an over-long prose body", () => {
    const body = Array.from(
      { length: LIMITS.proseBlockMaxLines + 1 },
      (_u, i) => `l${String(i)}`,
    ).join("\n");
    expect(() => renderMarkdownReport({ lead: "x", sections: [{ title: "S", body }] })).toThrow(
      /prose/i,
    );
  });

  it("throws on a title wider than the column budget", () => {
    const title = "評".repeat(LIMITS.titleMaxColumns);
    expect(() => renderMarkdownReport({ lead: "x", sections: [{ title }] })).toThrow(/columns/i);
  });

  it("caps a section's bullets and announces the shortfall", () => {
    const bullets = Array.from(
      { length: LIMITS.sectionMaxBullets + 3 },
      (_u, i) => `item${String(i)}`,
    );
    const out = renderMarkdownReport({ lead: "x", sections: [{ title: "S", bullets }] });
    expect(out).not.toContain(`item${String(LIMITS.sectionMaxBullets)}`);
    expect(out).toContain("3 more");
  });

  it("caps table rows and announces the shortfall", () => {
    const rows = Array.from({ length: LIMITS.sectionMaxBullets + 2 }, (_u, i) => [`r${String(i)}`]);
    const out = renderMarkdownReport({
      lead: "x",
      sections: [{ title: "S", table: { headers: ["h"], rows } }],
    });
    expect(out).not.toContain(`r${String(LIMITS.sectionMaxBullets)}`);
    expect(out).toContain("2 more");
  });

  it("elides a single over-long token — the residual, in this channel too", () => {
    const out = renderMarkdownReport({
      lead: "x",
      sections: [{ title: "S", bullets: [`sha256:${"a".repeat(500)}`] }],
    });
    const bullet = out.split("\n").find((l) => l.startsWith("- sha256")) ?? "";
    expect(displayWidth(bullet)).toBeLessThanOrEqual(LIMITS.bulletMaxColumns + 2);
    expect(bullet).toContain("…");
  });

  it("holds every bullet inside the column budget", () => {
    const out = renderMarkdownReport({
      lead: "x",
      sections: [{ title: "S", bullets: ["x".repeat(400), "評".repeat(200), "short"] }],
    });
    for (const line of out.split("\n").filter((l) => l.startsWith("- "))) {
      expect(displayWidth(line.slice(2))).toBeLessThanOrEqual(LIMITS.bulletMaxColumns);
    }
  });

  it("renders a minimal report without sections or a next action", () => {
    expect(renderMarkdownReport({ lead: "Done." })).toBe("**Done.**\n");
  });
});
