import { describe, expect, it } from "vitest";
import { createXdgPermissionsCheck } from "./xdg-permissions.js";

describe("createXdgPermissionsCheck", () => {
  it("passes when a path has the required mode", async () => {
    const check = createXdgPermissionsCheck({
      paths: [{ path: "/state/root", expectedMode: 0o700, kind: "dir" }],
      statMode: async () => 0o700,
    });
    const finding = await check.run();
    expect(finding.passed).toBe(true);
  });

  it("passes when no paths exist yet (fresh install)", async () => {
    const check = createXdgPermissionsCheck({
      paths: [{ path: "/state/root", expectedMode: 0o700, kind: "dir" }],
      statMode: async () => undefined,
    });
    const finding = await check.run();
    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("fresh install");
  });

  it("fails for a mismatched mode, naming the exact path and both modes", async () => {
    const check = createXdgPermissionsCheck({
      paths: [{ path: "/cache/root", expectedMode: 0o700, kind: "dir" }],
      statMode: async () => 0o755,
    });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("/cache/root");
    expect(finding.evidence).toContain("0700");
    expect(finding.evidence).toContain("0755");
  });
});
