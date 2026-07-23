import { describe, expect, it } from "vitest";
import { createEngineVersionCheck, isVersionWithinRange } from "./engine-version.js";

describe("isVersionWithinRange", () => {
  it("accepts a version inside the range", () => {
    expect(isVersionWithinRange("2.1.208", { min: "2.1.207", max: "2.1.210" })).toBe(true);
  });
  it("accepts the exact boundaries", () => {
    expect(isVersionWithinRange("2.1.207", { min: "2.1.207", max: "2.1.210" })).toBe(true);
    expect(isVersionWithinRange("2.1.210", { min: "2.1.207", max: "2.1.210" })).toBe(true);
  });
  it("rejects a version outside the range", () => {
    expect(isVersionWithinRange("1.0.0", { min: "2.1.207", max: "2.1.210" })).toBe(false);
    expect(isVersionWithinRange("3.0.0", { min: "2.1.207", max: "2.1.210" })).toBe(false);
  });
});

describe("createEngineVersionCheck", () => {
  it("passes for a version inside the accepted range", async () => {
    const check = createEngineVersionCheck({
      probe: async () => ({ stdout: "2.1.209 (Claude Code)\n", stderr: "", exitCode: 0 }),
    });
    const finding = await check.run();
    expect(finding.passed).toBe(true);
  });

  it("fails when the probe process itself fails to run", async () => {
    const check = createEngineVersionCheck({
      probe: async () => ({ stdout: "", stderr: "not found", exitCode: 127 }),
    });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
    expect(finding.repairStep).toContain("install");
  });

  it("fails when the version string is unparseable", async () => {
    const check = createEngineVersionCheck({
      probe: async () => ({ stdout: "not-a-version-string", stderr: "", exitCode: 0 }),
    });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("could not parse");
  });
});
