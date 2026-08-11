import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_POLICY } from "./presentation-policy.js";
import { ROLE_COLORS, STRUCTURE_COLORS, paint, stripAnsi } from "./colors.js";
import type { PresentationProfile } from "./glyphs.js";
import type { PresentationContext } from "./profile.js";
import {
  renderBullets,
  renderHeading,
  renderHumanReport,
  renderKeyValues,
  renderStatusLine,
} from "./human-report.js";

/** Monochrome context — what a pipe, a snapshot or `NO_COLOR` resolves to. */
const plain = (profile: PresentationProfile): PresentationContext => ({ profile, color: false });
/** Coloured context — what an interactive terminal resolves to. */
const lit = (profile: PresentationProfile): PresentationContext => ({ profile, color: true });

describe("renderStatusLine", () => {
  it("prefixes the text with the role's glyph for the given profile", () => {
    expect(renderStatusLine("ok", "gate passed", plain("emoji"))).toBe("✅ gate passed");
    expect(renderStatusLine("ok", "gate passed", plain("text"))).toBe("✓ gate passed");
    expect(renderStatusLine("ok", "gate passed", plain("ascii"))).toBe("+ gate passed");
  });

  it("renders failure and halt distinctly in every profile", () => {
    for (const profile of ["emoji", "text", "ascii"] as const) {
      expect(renderStatusLine("fail", "x", plain(profile))).not.toBe(
        renderStatusLine("blocked", "x", plain(profile)),
      );
    }
  });

  it("emits no trailing whitespace when the text is empty", () => {
    expect(renderStatusLine("info", "", plain("text"))).toBe("•");
  });

  it("paints the whole line in the role's hue, so a verdict is findable without reading it", () => {
    expect(renderStatusLine("fail", "gate failed", lit("text"))).toBe(
      paint(ROLE_COLORS.fail, "✗ gate failed", true),
    );
  });

  it("gives failure and halt different hues — they call for different actions", () => {
    expect(ROLE_COLORS.fail).not.toBe(ROLE_COLORS.blocked);
    expect(renderStatusLine("fail", "x", lit("text"))).not.toBe(
      renderStatusLine("blocked", "x", lit("text")),
    );
  });
});

describe("renderHeading", () => {
  it("underlines the title so a section break is visible in a plain terminal", () => {
    expect(renderHeading("Evidence", plain("text"))).toBe("Evidence\n────────");
  });

  it("uses a 7-bit rule in the ascii profile", () => {
    expect(renderHeading("Evidence", plain("ascii"))).toBe("Evidence\n--------");
  });

  it("matches the rule length to the title length", () => {
    const lines = renderHeading("Risk", plain("text")).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toHaveLength("Risk".length);
  });

  it("rejects an empty title rather than emitting a bare rule", () => {
    expect(() => renderHeading("", plain("text"))).toThrow(/title/i);
  });

  it("bolds the title and dims the rule, so the scaffolding recedes behind the label", () => {
    const rendered = renderHeading("Risk", lit("text"));
    expect(rendered).toContain(paint(STRUCTURE_COLORS.heading, "Risk", true));
    expect(rendered).toContain(paint(STRUCTURE_COLORS.rule, "────", true));
  });
});

describe("renderBullets", () => {
  it("renders one indented bullet per item", () => {
    expect(renderBullets(["first", "second"], plain("text"))).toBe("  • first\n  • second");
  });

  it("uses an ascii bullet in the ascii profile", () => {
    expect(renderBullets(["first"], plain("ascii"))).toBe("  - first");
  });

  it("returns the empty string for no items, so a caller can concatenate unconditionally", () => {
    expect(renderBullets([], plain("emoji"))).toBe("");
  });

  it("dims only the marker, leaving the item text at full contrast", () => {
    expect(renderBullets(["first"], lit("text"))).toBe(
      `  ${paint(STRUCTURE_COLORS.bullet, "•", true)} first`,
    );
  });
});

describe("renderKeyValues", () => {
  it("aligns values into a column", () => {
    expect(
      renderKeyValues(
        [
          { key: "run", value: "r-1" },
          { key: "changeSet", value: "cs-9" },
        ],
        plain("text"),
      ),
    ).toBe("run        r-1\nchangeSet  cs-9");
  });

  it("emits no trailing whitespace on a row whose value is empty", () => {
    const rendered = renderKeyValues(
      [
        { key: "a", value: "" },
        { key: "bb", value: "x" },
      ],
      plain("text"),
    );
    for (const line of rendered.split("\n")) {
      expect(line).toBe(line.replace(/\s+$/, ""));
    }
  });

  it("returns the empty string for no rows", () => {
    expect(renderKeyValues([], plain("text"))).toBe("");
  });

  it("dims the keys so the values carry the contrast", () => {
    const rendered = renderKeyValues([{ key: "run", value: "r-1" }], lit("text"));
    expect(rendered).toContain(paint(STRUCTURE_COLORS.key, "run", true));
    // The value itself stays unpainted — contrast belongs to the data, not the label.
    expect(rendered.endsWith("r-1")).toBe(true);
  });

  it("keeps the value column aligned once the keys are painted — padding is measured on the plain text", () => {
    const rendered = stripAnsi(
      renderKeyValues(
        [
          { key: "run", value: "r-1" },
          { key: "changeSet", value: "cs-9" },
        ],
        lit("text"),
      ),
    );
    expect(rendered).toBe("run        r-1\nchangeSet  cs-9");
  });
});

describe("renderHumanReport", () => {
  it("puts the lead first, before any section", () => {
    const rendered = renderHumanReport(
      { lead: "3 gates passed, 1 failed.", sections: [{ title: "Failed", bullets: ["lint"] }] },
      plain("text"),
    );
    expect(rendered.indexOf("3 gates passed")).toBeLessThan(rendered.indexOf("Failed"));
  });

  it("holds the lead within the policy's lead budget", () => {
    const rendered = renderHumanReport({ lead: "one line.", sections: [] }, plain("text"));
    const leadBlock = rendered.split("\n\n")[0] ?? "";
    expect(leadBlock.split("\n").length).toBeLessThanOrEqual(
      DEFAULT_PRESENTATION_POLICY.limits.leadAnswerMaxLines,
    );
  });

  it("rejects a lead longer than the policy's budget rather than silently emitting a wall", () => {
    const overLong = Array.from(
      { length: DEFAULT_PRESENTATION_POLICY.limits.leadAnswerMaxLines + 1 },
      (_unused, index) => `line ${index}`,
    ).join("\n");
    expect(() => renderHumanReport({ lead: overLong, sections: [] }, plain("text"))).toThrow(
      /lead/i,
    );
  });

  it("headings every section, so a long report is never an undifferentiated block", () => {
    const rendered = renderHumanReport(
      {
        lead: "Two findings.",
        sections: [
          { title: "Risk", body: "one moderate risk" },
          { title: "Next", bullets: ["rerun the gate"] },
        ],
      },
      plain("text"),
    );
    expect(rendered).toContain("Risk\n────");
    expect(rendered).toContain("Next\n────");
  });

  it("renders a section's body and bullets in that order", () => {
    const rendered = renderHumanReport(
      { lead: "x", sections: [{ title: "S", body: "prose", bullets: ["b"] }] },
      plain("text"),
    );
    expect(rendered.indexOf("prose")).toBeLessThan(rendered.indexOf("• b"));
  });

  it("ends with exactly one trailing newline, matching the CommandResult stdout convention", () => {
    const rendered = renderHumanReport({ lead: "x", sections: [] }, plain("text"));
    expect(rendered.endsWith("\n")).toBe(true);
    expect(rendered.endsWith("\n\n")).toBe(false);
  });

  it("emits no trailing whitespace on any line", () => {
    const rendered = renderHumanReport(
      { lead: "x", sections: [{ title: "S", bullets: ["b"] }] },
      plain("emoji"),
    );
    for (const line of rendered.split("\n")) {
      expect(line).toBe(line.replace(/\s+$/, ""));
    }
  });

  it("bolds the lead — the one line a reader who lost the thread must land on", () => {
    expect(renderHumanReport({ lead: "Done.", sections: [] }, lit("text"))).toContain(
      paint(STRUCTURE_COLORS.lead, "Done.", true),
    );
  });
});

/**
 * `docs/presentation-policy.md` declares six structural limits and calls going
 * over one "a bug". Until 2026-08-11 exactly ONE of the six (`leadAnswerMaxLines`)
 * was enforced anywhere in code; the other five existed only as prose in the
 * manager protocol's instruction block, which that same document concedes is
 * "instruction only". So the one channel the document claims is **structurally**
 * enforced would happily emit a forty-bullet section of sixty-word bullets.
 *
 * WHY THE TWO HALVES ARE ENFORCED DIFFERENTLY. `lead` and `body` are prose an
 * author typed, so exceeding them is a programming error and throws — loudly,
 * at the call site that can fix it. `bullets` are DATA (doctor findings, evidence
 * rows, work units) whose count and length are not known when the code is
 * written; throwing there would turn "the host has eleven findings" into a
 * crashed command, which is a strictly worse outcome than a capped list. Those
 * degrade structurally instead, and say what they dropped.
 */
describe("the structural limits are enforced, not merely declared", () => {
  const { proseBlockMaxLines, bulletMaxWords, sectionMaxBullets } =
    DEFAULT_PRESENTATION_POLICY.limits;

  it("rejects a prose body longer than the policy's block budget", () => {
    const wall = Array.from({ length: proseBlockMaxLines + 1 }, (_u, i) => `line ${i}`).join("\n");
    expect(() =>
      renderHumanReport({ lead: "x", sections: [{ title: "S", body: wall }] }, plain("text")),
    ).toThrow(/prose/i);
  });

  it("accepts a prose body exactly at the budget — a limit is a floor, not a target", () => {
    const atBudget = Array.from({ length: proseBlockMaxLines }, (_u, i) => `line ${i}`).join("\n");
    expect(() =>
      renderHumanReport({ lead: "x", sections: [{ title: "S", body: atBudget }] }, plain("text")),
    ).not.toThrow();
  });

  it("elides a bullet past the word budget rather than emitting an unscannable line", () => {
    const longBullet = Array.from({ length: bulletMaxWords + 5 }, (_u, i) => `w${i}`).join(" ");
    const rendered = renderHumanReport(
      { lead: "x", sections: [{ title: "S", bullets: [longBullet] }] },
      plain("text"),
    );
    const bulletLine = rendered.split("\n").find((l) => l.includes("w0")) ?? "";
    expect(bulletLine).toContain("…");
    expect(bulletLine).toContain(`w${String(bulletMaxWords - 1)}`);
    expect(bulletLine).not.toContain(`w${String(bulletMaxWords)}`);
  });

  it("leaves a bullet at or under the word budget byte-identical", () => {
    const exact = Array.from({ length: bulletMaxWords }, (_u, i) => `w${i}`).join(" ");
    const rendered = renderHumanReport(
      { lead: "x", sections: [{ title: "S", bullets: [exact] }] },
      plain("text"),
    );
    expect(rendered).toContain(`• ${exact}\n`);
    expect(rendered).not.toContain("…");
  });

  it("caps a section at the bullet budget and says how many it dropped", () => {
    const many = Array.from({ length: sectionMaxBullets + 3 }, (_u, i) => `item ${i}`);
    const rendered = renderHumanReport(
      { lead: "x", sections: [{ title: "S", bullets: many }] },
      plain("text"),
    );
    expect(rendered).toContain(`item ${String(sectionMaxBullets - 1)}`);
    expect(rendered).not.toContain(`item ${String(sectionMaxBullets)}`);
    // The dropped items are ANNOUNCED. A silently truncated list reads as a
    // complete one, which is the exact failure this policy exists to prevent.
    expect(rendered).toContain("3 more");
    expect(rendered).toContain("--json");
  });

  it("adds no overflow line when the section is exactly at the budget", () => {
    const exact = Array.from({ length: sectionMaxBullets }, (_u, i) => `item ${i}`);
    const rendered = renderHumanReport(
      { lead: "x", sections: [{ title: "S", bullets: exact }] },
      plain("text"),
    );
    expect(rendered).toContain(`item ${String(sectionMaxBullets - 1)}`);
    expect(rendered).not.toContain("more");
  });

  it("keeps colour additive across both degradations", () => {
    const report = {
      lead: "x",
      sections: [
        {
          title: "S",
          bullets: Array.from(
            { length: sectionMaxBullets + 2 },
            (_u, i) => `${String(i)} ${"word ".repeat(bulletMaxWords + 4)}`,
          ),
        },
      ],
    };
    for (const profile of ["emoji", "text", "ascii"] as const) {
      expect(stripAnsi(renderHumanReport(report, lit(profile)))).toBe(
        renderHumanReport(report, plain(profile)),
      );
    }
  });

  /**
   * `tableMinRows` says three-plus items each carrying two-plus attributes is a
   * TABLE, not a bullet list — but until 2026-08-11 `HumanReportSection` had no
   * way to express one, so the only limit in the policy with no representation
   * in the renderer was the one the policy names as mandatory. `rows` is that
   * representation, over `renderKeyValues` (which, like `renderHumanReport`
   * itself, had been written and then left with no production caller).
   */
  it("renders rows as an aligned two-column block", () => {
    const rendered = renderHumanReport(
      {
        lead: "x",
        sections: [
          {
            title: "Commands",
            rows: [
              { key: "run", value: "Dispatch a new run." },
              { key: "status", value: "Show a run's status." },
            ],
          },
        ],
      },
      plain("text"),
    );
    expect(rendered).toContain("  run     Dispatch a new run.");
    expect(rendered).toContain("  status  Show a run's status.");
  });

  it("caps rows at the section budget and announces the shortfall", () => {
    const rows = Array.from({ length: sectionMaxBullets + 2 }, (_u, i) => ({
      key: `k${String(i)}`,
      value: "v",
    }));
    const rendered = renderHumanReport(
      { lead: "x", sections: [{ title: "S", rows }] },
      plain("text"),
    );
    expect(rendered).not.toContain(`k${String(sectionMaxBullets)}`);
    expect(rendered).toContain("2 more");
  });

  it("elides an over-long row value, exactly as it does a bullet", () => {
    const long = Array.from({ length: bulletMaxWords + 4 }, (_u, i) => `w${String(i)}`).join(" ");
    const rendered = renderHumanReport(
      { lead: "x", sections: [{ title: "S", rows: [{ key: "k", value: long }] }] },
      plain("text"),
    );
    expect(rendered).toContain("…");
    expect(rendered).not.toContain(`w${String(bulletMaxWords)}`);
  });

  it("keeps row alignment and colour additive together", () => {
    const report = {
      lead: "x",
      sections: [
        {
          title: "S",
          rows: [
            { key: "a", value: "one" },
            { key: "bbbb", value: "two" },
          ],
        },
      ],
    };
    expect(stripAnsi(renderHumanReport(report, lit("text")))).toBe(
      renderHumanReport(report, plain("text")),
    );
  });

  it("emits no trailing whitespace on a capped, elided section", () => {
    const rendered = renderHumanReport(
      {
        lead: "x",
        sections: [
          { title: "S", bullets: Array.from({ length: sectionMaxBullets + 2 }, () => "a b c") },
        ],
      },
      plain("emoji"),
    );
    for (const line of rendered.split("\n")) {
      expect(line).toBe(line.replace(/\s+$/, ""));
    }
  });
});

/**
 * The load-bearing accessibility invariant: colour is a SECOND channel layered
 * on the glyphs and words, never the carrier of meaning and never a change to
 * layout. If stripping the escapes from a coloured render did not reproduce the
 * monochrome render byte for byte, then something would be visible only in
 * colour — and would vanish under `NO_COLOR`, in a monochrome terminal, or for
 * a reader with colour-vision deficiency.
 */
describe("colour is additive only", () => {
  const report = {
    lead: "3 gates passed, 1 failed.",
    sections: [
      { title: "Failed", body: "the lint gate", bullets: ["no evidence reference"] },
      { title: "Next", bullets: ["rerun after the fix", "attach the evidence"] },
    ],
  };

  for (const profile of ["emoji", "text", "ascii"] as const) {
    it(`strips back to the monochrome render, byte for byte (${profile})`, () => {
      expect(stripAnsi(renderHumanReport(report, lit(profile)))).toBe(
        renderHumanReport(report, plain(profile)),
      );
    });
  }

  it("holds for every status role", () => {
    for (const role of Object.keys(ROLE_COLORS) as (keyof typeof ROLE_COLORS)[]) {
      expect(stripAnsi(renderStatusLine(role, "detail", lit("emoji")))).toBe(
        renderStatusLine(role, "detail", plain("emoji")),
      );
    }
  });

  it("holds for key-value blocks, whose alignment could otherwise drift on escape bytes", () => {
    const rows = [
      { key: "run", value: "r-1" },
      { key: "changeSet", value: "cs-9" },
    ];
    expect(stripAnsi(renderKeyValues(rows, lit("text")))).toBe(
      renderKeyValues(rows, plain("text")),
    );
  });
});
