import { describe, expect, it } from "vitest";
import {
  HIGH_IMPACT_CAPABILITY_FLAGS,
  HighImpactCapabilityFlagSchema,
} from "./high-impact-capability-flag.js";

describe("HighImpactCapabilityFlag", () => {
  it("has exactly 11 members", () => {
    expect(HIGH_IMPACT_CAPABILITY_FLAGS.length).toBe(11);
  });

  it("accepts every declared label", () => {
    for (const flag of HIGH_IMPACT_CAPABILITY_FLAGS) {
      expect(HighImpactCapabilityFlagSchema.safeParse(flag).success).toBe(true);
    }
  });

  it("rejects a label outside the closed union", () => {
    expect(HighImpactCapabilityFlagSchema.safeParse("random capability").success).toBe(false);
  });

  it("labels byte-match what 18/20 cite verbatim (Gap 10)", () => {
    expect(HIGH_IMPACT_CAPABILITY_FLAGS).toEqual([
      "assignment",
      "reporter change",
      "closing transitions",
      "sprint completion",
      "attachments",
      "bulk mutations",
      "issue creation",
      "alert disabling",
      "contact points",
      "mute timings",
      "notification templates",
    ]);
  });

  it("Jira's 7 members are present verbatim", () => {
    const jiraMembers = [
      "assignment",
      "reporter change",
      "closing transitions",
      "sprint completion",
      "attachments",
      "bulk mutations",
      "issue creation",
    ];
    for (const label of jiraMembers) {
      expect(HIGH_IMPACT_CAPABILITY_FLAGS).toContain(label);
    }
  });

  it("Grafana's 4 members are present verbatim", () => {
    const grafanaMembers = [
      "alert disabling",
      "contact points",
      "mute timings",
      "notification templates",
    ];
    for (const label of grafanaMembers) {
      expect(HIGH_IMPACT_CAPABILITY_FLAGS).toContain(label);
    }
  });
});
