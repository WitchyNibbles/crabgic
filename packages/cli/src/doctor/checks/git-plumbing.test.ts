import { describe, expect, it } from "vitest";
import { createGitPlumbingCheck } from "./git-plumbing.js";

describe("createGitPlumbingCheck", () => {
  it("passes when git is present", async () => {
    const check = createGitPlumbingCheck({
      probe: async () => ({ stdout: "git version 2.43.0\n", stderr: "", exitCode: 0 }),
    });
    const finding = await check.run();
    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("2.43.0");
  });

  it("fails when git is missing", async () => {
    const check = createGitPlumbingCheck({
      probe: async () => ({ stdout: "", stderr: "not found", exitCode: 127 }),
    });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
    expect(finding.repairStep).toContain("install git");
  });
});
