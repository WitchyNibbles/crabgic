import { describe, expect, it } from "vitest";
import {
  AttributionLeakError,
  assertNeutralRendering,
  findAttributionLeaks,
} from "../src/neutral-rendering-assertion.js";

/**
 * roadmap/23-release-hardening.md work item 5's fail-first vector,
 * verbatim: "a seeded commit body carrying a dev-engine attribution leak
 * ('Generated with', 'Co-Authored-By: … Claude…') must FAIL the
 * neutral-rendering assertion." This file IS that proof: a seeded, leaking
 * string is fed straight to the assertion this project trusts to certify
 * a real render/publish — proving the assertion itself catches the leak
 * BEFORE any real `@eo/git-engine`/`@eo/renderer` call is ever exercised
 * (see `branch-commit-golden-scenarios.test.ts` and
 * `publish-attribution-leak-scenario.test.ts` for the real-subsystem
 * counterparts of the identical vector).
 */
describe("assertNeutralRendering / findAttributionLeaks (RED before GREEN)", () => {
  it('RED: a seeded "Generated with" commit body is caught', () => {
    const leaking = "feat: add widget\n\nGenerated with Claude Code\n";
    const findings = findAttributionLeaks(leaking);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.token === "Generated with")).toBe(true);
    expect(() => assertNeutralRendering(leaking)).toThrow(AttributionLeakError);
  });

  it("RED: a seeded Co-Authored-By...Claude trailer is caught", () => {
    const leaking = "fix: correct off-by-one\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n";
    const findings = findAttributionLeaks(leaking);
    expect(findings.some((f) => f.token === "Co-Authored-By")).toBe(true);
    expect(() => assertNeutralRendering(leaking)).toThrow(AttributionLeakError);
  });

  it("RED: the robot-emoji attribution line is caught", () => {
    const leaking = "chore: bump deps\n\n🤖 Generated with Claude Code\n";
    expect(() => assertNeutralRendering(leaking)).toThrow(AttributionLeakError);
  });

  it("GREEN: a clean commit body passes with zero findings", () => {
    const clean = "feat: add widget support\n\nWhy: customer request\nRisk: low\n";
    expect(findAttributionLeaks(clean)).toEqual([]);
    expect(() => assertNeutralRendering(clean)).not.toThrow();
  });

  it("AttributionLeakError carries every finding and a human-legible message naming the token(s)", () => {
    const leaking = "Generated with Claude Code, Co-Authored-By: Claude <noreply@anthropic.com>";
    try {
      assertNeutralRendering(leaking);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AttributionLeakError);
      const attributionErr = err as AttributionLeakError;
      expect(attributionErr.findings.length).toBeGreaterThanOrEqual(2);
      expect(attributionErr.message).toContain("Generated with");
      expect(attributionErr.message).toContain("Co-Authored-By");
      expect(attributionErr.name).toBe("AttributionLeakError");
    }
  });

  it("findings are sorted by index ascending, matching the shared scanner's own contract", () => {
    const leaking = "Co-Authored-By: someone\n...\nGenerated with a tool";
    const findings = findAttributionLeaks(leaking);
    for (let i = 1; i < findings.length; i++) {
      expect(findings[i]!.index).toBeGreaterThan(findings[i - 1]!.index);
    }
  });
});
