import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_POLICY, PRESENTATION_GLYPH_ROLES, glyph } from "@crabgic/contracts";
import { buildOutputStyle, OUTPUT_STYLE_NAME } from "./output-style.js";
import { buildManagerProtocolBlock } from "./manager-protocol.js";

const LIMITS = DEFAULT_PRESENTATION_POLICY.limits;

/**
 * The output style is the PREVENTION layer for the manager channel: it replaces
 * the assistant's base communication prompt, so the reporting rules become the
 * default register rather than an instruction competing with one.
 *
 * The installer writes it rather than the plugin shipping it, because
 * `docs/engine-baseline.md` §23 measured that output styles are not a plugin
 * component. §23.4 records that the behavioural half is NOT yet verified — so
 * these tests pin the artifact's shape and its agreement with the policy, which
 * is everything that can be established without a live turn.
 */
describe("buildOutputStyle", () => {
  const style = buildOutputStyle();

  it("carries frontmatter naming the style exactly as the settings value spells it", () => {
    expect(style.startsWith("---\n")).toBe(true);
    expect(style).toContain(`name: ${OUTPUT_STYLE_NAME}`);
    expect(style).toMatch(/^description: .+$/m);
  });

  it("states the accessibility reason, so the rules are not read as taste", () => {
    expect(style).toMatch(/accessibility requirement, not a\s+style preference/);
  });

  it("quotes every structural limit from the policy rather than hardcoding a second copy", () => {
    expect(style).toContain(`≤${String(LIMITS.leadAnswerMaxLines)} lines`);
    expect(style).toContain(`Past ${String(LIMITS.headingRequiredAboveLines)} lines`);
    expect(style).toContain(`${String(LIMITS.proseBlockMaxLines)} unbroken`);
    expect(style).toContain(`≤${String(LIMITS.bulletMaxWords)} words`);
    expect(style).toContain(`≤${String(LIMITS.sectionMaxBullets)} per section`);
    expect(style).toContain(`${String(LIMITS.tableMinRows)}+ items`);
  });

  it("carries the four volume rules, which the shape limits cannot express", () => {
    expect(style).toMatch(/no preamble/i);
    expect(style).toMatch(/recap/i);
    expect(style).toMatch(/tangent/i);
    expect(style).toMatch(/step \d+ of \d+/i);
    expect(style).toMatch(/next action/i);
  });

  it("renders the whole glyph vocabulary, each paired with its role", () => {
    for (const role of PRESENTATION_GLYPH_ROLES) {
      expect(style, `missing glyph role: ${role}`).toContain(`${glyph(role, "emoji")} ${role}`);
    }
  });

  it("frames glyphs as navigation aids rather than decoration", () => {
    expect(style).toMatch(/not\s+decoration/i);
  });

  it("carves out shared artifacts, which stay neutral and emoji-free", () => {
    expect(style).toMatch(/emoji-free/i);
    expect(style.toLowerCase()).toMatch(/pr|commit|jira|grafana/);
  });

  /**
   * This is loaded into EVERY turn in the project, so every line costs tokens
   * forever — the same discipline the manager protocol block's line cap
   * enforces on itself. Rationale belongs in `docs/presentation-policy.md`,
   * which is loaded on demand.
   */
  it("stays compact enough to sit in every turn", () => {
    expect(style.split("\n").length).toBeLessThanOrEqual(45);
  });
});

/**
 * The style and the protocol block are two texts stating the same rules to the
 * same model. If they ever disagreed about a number, one of them would be
 * wrong and nothing would say which — so both interpolate from
 * `HUMAN_REPORT_LIMITS` and this asserts the agreement rather than trusting it.
 */
describe("parity with the manager protocol block", () => {
  it("states the same budgets as the always-loaded protocol block", () => {
    const style = buildOutputStyle();
    const block = buildManagerProtocolBlock();
    for (const value of [
      `≤${String(LIMITS.leadAnswerMaxLines)} lines`,
      `${String(LIMITS.proseBlockMaxLines)} unbroken`,
      `≤${String(LIMITS.bulletMaxWords)} words`,
      `≤${String(LIMITS.sectionMaxBullets)} per section`,
      `${String(LIMITS.tableMinRows)}+ items`,
    ]) {
      expect(style, `style missing: ${value}`).toContain(value);
      expect(block, `protocol block missing: ${value}`).toContain(value);
    }
  });
});
