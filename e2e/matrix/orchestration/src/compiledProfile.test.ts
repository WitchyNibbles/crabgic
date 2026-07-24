import { describe, expect, it } from "vitest";
import { allowAllAdjudicate, buildMinimalCompiledProfile } from "./compiledProfile.js";

describe("buildMinimalCompiledProfile", () => {
  it("returns a minimal, internally-consistent CompiledWorkerProfile", () => {
    const profile = buildMinimalCompiledProfile();
    expect(profile.permissions.defaultMode).toBe("dontAsk");
    expect(profile.sandbox.enabled).toBe(true);
    expect(profile.sdkOptions.strictMcpConfig).toBe(true);
  });

  it("returns a fresh object on every call (no shared mutable state across scenarios)", () => {
    const a = buildMinimalCompiledProfile();
    const b = buildMinimalCompiledProfile();
    expect(a).not.toBe(b);
    expect(a.permissions).not.toBe(b.permissions);
  });
});

describe("allowAllAdjudicate", () => {
  it("always allows, passing the tool input through unchanged", async () => {
    const input = { command: "echo hi" };
    const verdict = await allowAllAdjudicate("Bash", input);
    expect(verdict.behavior).toBe("allow");
    expect(verdict.updatedInput).toBe(input);
  });
});
