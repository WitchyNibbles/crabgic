import { describe, expect, it } from "vitest";
import { createWsl2WarningsCheck } from "./wsl2-warnings.js";

describe("createWsl2WarningsCheck", () => {
  it("passes trivially on a non-WSL2 host", async () => {
    const check = createWsl2WarningsCheck({
      isWsl2: async () => false,
      stateRootPath: "/mnt/c/state",
      cacheRootPath: "/mnt/c/cache",
    });
    const finding = await check.run();
    expect(finding.passed).toBe(true);
  });

  it("warns when the state/cache roots sit under /mnt/c on WSL2", async () => {
    const check = createWsl2WarningsCheck({
      isWsl2: async () => true,
      stateRootPath: "/mnt/c/Users/me/state",
      cacheRootPath: "/mnt/c/Users/me/cache",
    });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
    expect(finding.severity).toBe("warning");
    expect(finding.evidence).toContain("/mnt/c");
  });

  it("passes on WSL2 when roots are on the Linux filesystem", async () => {
    const check = createWsl2WarningsCheck({
      isWsl2: async () => true,
      stateRootPath: "/home/me/.local/state/engineering-orchestrator",
      cacheRootPath: "/home/me/.cache/engineering-orchestrator",
    });
    const finding = await check.run();
    expect(finding.passed).toBe(true);
  });
});
