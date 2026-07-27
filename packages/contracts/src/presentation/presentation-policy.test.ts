import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_POLICY,
  HUMAN_REPORT_LIMITS,
  PresentationPolicySchema,
} from "./presentation-policy.js";
import { PRESENTATION_GLYPH_ROLES } from "./glyphs.js";
import { CURRENT_SCHEMA_VERSION } from "../shared/schema-version.js";

describe("HUMAN_REPORT_LIMITS", () => {
  it("puts the answer in the first two lines", () => {
    expect(HUMAN_REPORT_LIMITS.leadAnswerMaxLines).toBe(2);
  });

  it("requires headings once a report outgrows a glance", () => {
    expect(HUMAN_REPORT_LIMITS.headingRequiredAboveLines).toBe(5);
  });

  it("caps a bullet at a scannable length", () => {
    expect(HUMAN_REPORT_LIMITS.bulletMaxWords).toBe(15);
  });

  it("caps an unbroken prose block below the heading threshold, so prose can never become a wall", () => {
    expect(HUMAN_REPORT_LIMITS.proseBlockMaxLines).toBeLessThan(
      HUMAN_REPORT_LIMITS.headingRequiredAboveLines,
    );
  });

  it("names the point at which a list becomes a table", () => {
    expect(HUMAN_REPORT_LIMITS.tableMinRows).toBe(3);
  });

  it("caps bullets per section", () => {
    expect(HUMAN_REPORT_LIMITS.sectionMaxBullets).toBe(7);
  });
});

describe("PresentationPolicySchema", () => {
  it("rejects unknown fields", () => {
    expect(() =>
      PresentationPolicySchema.parse({ ...DEFAULT_PRESENTATION_POLICY, extra: true }),
    ).toThrow();
  });

  it("rejects a non-positive limit", () => {
    expect(() =>
      PresentationPolicySchema.parse({
        ...DEFAULT_PRESENTATION_POLICY,
        limits: { ...DEFAULT_PRESENTATION_POLICY.limits, bulletMaxWords: 0 },
      }),
    ).toThrow();
  });

  it("rejects a glyph table missing a role", () => {
    const { ok: _dropped, ...missingOk } = DEFAULT_PRESENTATION_POLICY.glyphs;
    expect(() =>
      PresentationPolicySchema.parse({ ...DEFAULT_PRESENTATION_POLICY, glyphs: missingOk }),
    ).toThrow();
  });
});

describe("DEFAULT_PRESENTATION_POLICY", () => {
  it("carries the current schema version, like every other contract in this package", () => {
    expect(DEFAULT_PRESENTATION_POLICY.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("round-trips through its own schema (drift between constants and shape fails at module load)", () => {
    expect(PresentationPolicySchema.parse(DEFAULT_PRESENTATION_POLICY)).toEqual(
      DEFAULT_PRESENTATION_POLICY,
    );
  });

  it("carries a glyph for every role", () => {
    expect(Object.keys(DEFAULT_PRESENTATION_POLICY.glyphs).sort()).toEqual(
      [...PRESENTATION_GLYPH_ROLES].sort(),
    );
  });

  it("exposes the same limit values as the constants it is built from", () => {
    expect(DEFAULT_PRESENTATION_POLICY.limits).toEqual(HUMAN_REPORT_LIMITS);
  });
});
