import { describe, expect, it } from "vitest";
import { INTENT_CONTRACT_SECTION_KEYS } from "@eo/contracts";
import { DEFAULT_GATE_RISK_TAGS, GATE_RISK_TAGS, isGateRiskTag } from "./risk-tags.js";

describe("GATE_RISK_TAGS", () => {
  it("contains every IntentContract section key plus the 4 always-on defaults, with no duplicates", () => {
    const asSet = new Set(GATE_RISK_TAGS);
    expect(asSet.size).toBe(GATE_RISK_TAGS.length);
    for (const key of INTENT_CONTRACT_SECTION_KEYS) {
      expect(GATE_RISK_TAGS).toContain(key);
    }
    for (const tag of DEFAULT_GATE_RISK_TAGS) {
      expect(GATE_RISK_TAGS).toContain(tag);
    }
    expect(GATE_RISK_TAGS.length).toBe(INTENT_CONTRACT_SECTION_KEYS.length + 4);
  });

  it("includes 'security' (shared with 21) and 'performance' (15-exclusive) among the section-derived tags", () => {
    expect(GATE_RISK_TAGS).toContain("security");
    expect(GATE_RISK_TAGS).toContain("performance");
  });

  it("isGateRiskTag accepts every member and rejects an unknown string", () => {
    for (const tag of GATE_RISK_TAGS) {
      expect(isGateRiskTag(tag)).toBe(true);
    }
    expect(isGateRiskTag("not-a-real-tag")).toBe(false);
  });
});
