import { describe, expect, it } from "vitest";
import { PRESENTATION_GLYPH_ROLES } from "./glyphs.js";
import { ROLE_COLORS, STRUCTURE_COLORS, SGR_RESET, paint, paintRole, stripAnsi } from "./colors.js";

describe("ROLE_COLORS", () => {
  it("has exactly one entry per glyph role, and no extras", () => {
    expect(Object.keys(ROLE_COLORS).sort()).toEqual([...PRESENTATION_GLYPH_ROLES].sort());
  });

  it("stores bare SGR parameter strings, never a pre-escaped sequence", () => {
    for (const role of PRESENTATION_GLYPH_ROLES) {
      expect(ROLE_COLORS[role], role).toMatch(/^[0-9;]+$/);
    }
  });

  it("gives the four verdict roles four distinct hues, since they are the ones read under pressure", () => {
    const verdicts = new Set([
      ROLE_COLORS.ok,
      ROLE_COLORS.fail,
      ROLE_COLORS.warn,
      ROLE_COLORS.blocked,
    ]);
    expect(verdicts.size).toBe(4);
  });

  it("de-emphasises the no-verdict roles with the same low-salience grey", () => {
    expect(ROLE_COLORS.pending).toBe(ROLE_COLORS.info);
  });
});

describe("STRUCTURE_COLORS", () => {
  it("carries the styles the human renderer needs for layout, not for verdicts", () => {
    expect(Object.keys(STRUCTURE_COLORS).sort()).toEqual([
      "bullet",
      "heading",
      "key",
      "lead",
      "rule",
    ]);
  });

  it("bolds the two things a distracted reader must land on first", () => {
    expect(STRUCTURE_COLORS.lead).toContain("1");
    expect(STRUCTURE_COLORS.heading).toContain("1");
  });

  it("stores bare SGR parameter strings", () => {
    for (const [name, code] of Object.entries(STRUCTURE_COLORS)) {
      expect(code, name).toMatch(/^[0-9;]+$/);
    }
  });
});

describe("paint", () => {
  it("returns the text untouched when colour is off — no escape bytes reach a pipe", () => {
    expect(paint("38;5;114", "done", false)).toBe("done");
  });

  it("wraps the text in the code and always resets", () => {
    expect(paint("38;5;114", "done", true)).toBe(`\u001b[38;5;114mdone${SGR_RESET}`);
  });

  it("never emits an unterminated sequence", () => {
    const painted = paint(ROLE_COLORS.fail, "x", true);
    expect(painted.endsWith(SGR_RESET)).toBe(true);
    expect(painted.split("\u001b[").length - 1).toBe(2);
  });

  it("leaves empty text alone rather than emitting a bare colour change", () => {
    expect(paint(ROLE_COLORS.ok, "", true)).toBe("");
  });
});

describe("paintRole", () => {
  it("paints in the role's own hue", () => {
    expect(paintRole("blocked", "halted", true)).toBe(paint(ROLE_COLORS.blocked, "halted", true));
  });

  it("passes the disabled case straight through", () => {
    expect(paintRole("ok", "done", false)).toBe("done");
  });

  it("covers every role without throwing", () => {
    for (const role of PRESENTATION_GLYPH_ROLES) {
      expect(stripAnsi(paintRole(role, "x", true)), role).toBe("x");
    }
  });
});

describe("stripAnsi", () => {
  it("recovers the original text from a painted string", () => {
    expect(stripAnsi(paint(ROLE_COLORS.warn, "careful", true))).toBe("careful");
  });

  it("is a no-op on unpainted text", () => {
    expect(stripAnsi("careful")).toBe("careful");
  });

  it("removes every sequence from a multi-painted string", () => {
    const mixed = `${paint(ROLE_COLORS.ok, "a", true)} ${paint(ROLE_COLORS.fail, "b", true)}`;
    expect(stripAnsi(mixed)).toBe("a b");
  });
});
