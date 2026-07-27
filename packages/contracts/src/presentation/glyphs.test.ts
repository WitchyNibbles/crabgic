import { describe, expect, it } from "vitest";
import {
  PRESENTATION_GLYPHS,
  PRESENTATION_GLYPH_ROLES,
  PRESENTATION_PROFILES,
  glyph,
} from "./glyphs.js";

describe("PRESENTATION_GLYPH_ROLES", () => {
  it("is a closed union covering every state the harness reports to a human", () => {
    expect([...PRESENTATION_GLYPH_ROLES]).toEqual([
      "ok",
      "fail",
      "warn",
      "blocked",
      "pending",
      "running",
      "parked",
      "question",
      "evidence",
      "info",
    ]);
  });

  it("has exactly one glyph-table entry per role, and no extras", () => {
    expect(Object.keys(PRESENTATION_GLYPHS).sort()).toEqual([...PRESENTATION_GLYPH_ROLES].sort());
  });
});

describe("PRESENTATION_GLYPHS", () => {
  it("defines all three profiles for every role", () => {
    for (const role of PRESENTATION_GLYPH_ROLES) {
      for (const profile of PRESENTATION_PROFILES) {
        expect(PRESENTATION_GLYPHS[role][profile], `${role}.${profile}`).toBeTruthy();
      }
    }
  });

  it("keeps every ascii glyph inside 7-bit ASCII, so a terminal without Unicode never mangles it", () => {
    for (const role of PRESENTATION_GLYPH_ROLES) {
      expect(PRESENTATION_GLYPHS[role].ascii, role).toMatch(/^[\x21-\x7e]+$/);
    }
  });

  it("keeps every glyph a single visual cell in the text and ascii profiles", () => {
    for (const role of PRESENTATION_GLYPH_ROLES) {
      expect([...PRESENTATION_GLYPHS[role].text], role).toHaveLength(1);
      expect([...PRESENTATION_GLYPHS[role].ascii], role).toHaveLength(1);
    }
  });

  it("preserves the markers the CLI status renderer already emits, so its text-profile output stays byte-identical", () => {
    expect(PRESENTATION_GLYPHS.ok.text).toBe("✓");
    expect(PRESENTATION_GLYPHS.fail.text).toBe("✗");
    expect(PRESENTATION_GLYPHS.parked.text).toBe("⏸");
    expect(PRESENTATION_GLYPHS.pending.text).toBe("•");
    expect(PRESENTATION_GLYPHS.running.text).toBe("•");
    expect(PRESENTATION_GLYPHS.info.text).toBe("•");
  });

  it("distinguishes success, failure and halt in the emoji profile", () => {
    const distinct = new Set([
      PRESENTATION_GLYPHS.ok.emoji,
      PRESENTATION_GLYPHS.fail.emoji,
      PRESENTATION_GLYPHS.blocked.emoji,
      PRESENTATION_GLYPHS.warn.emoji,
    ]);
    expect(distinct.size).toBe(4);
  });
});

describe("glyph", () => {
  it("selects by profile", () => {
    expect(glyph("ok", "emoji")).toBe(PRESENTATION_GLYPHS.ok.emoji);
    expect(glyph("ok", "text")).toBe("✓");
    expect(glyph("ok", "ascii")).toBe("+");
  });

  it("returns the same value on repeated calls (pure, no hidden state)", () => {
    expect(glyph("blocked", "emoji")).toBe(glyph("blocked", "emoji"));
  });
});
