import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_POLICY,
  ROLE_COLORS,
  STRUCTURE_COLORS,
  paint,
  stripAnsi,
  type PresentationContext,
  type PresentationProfile,
} from "@crabgic/contracts";
import {
  renderBullets,
  renderHeading,
  renderHumanReport,
  renderKeyValues,
  renderStatusLine,
} from "./human.js";

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
