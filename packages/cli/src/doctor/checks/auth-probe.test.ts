import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAuthProbeCheck,
  createRealAuthProbe,
  createRealAuthStateResolver,
} from "./auth-probe.js";

describe("createAuthProbeCheck", () => {
  it("passes for a valid auth state", async () => {
    const check = createAuthProbeCheck({ probe: async () => "valid" });
    const finding = await check.run();
    expect(finding.passed).toBe(true);
    expect(finding.evidence).not.toMatch(/sk-|token|Bearer/i);
  });

  it("fails for a missing auth state with a repair step, never printing a token value", async () => {
    const check = createAuthProbeCheck({ probe: async () => "missing" });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
    expect(finding.repairStep).toContain("setup-token");
  });

  it("fails for an invalid auth state", async () => {
    const check = createAuthProbeCheck({ probe: async () => "invalid" });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
  });

  it("createRealAuthProbe passes the resolver through unchanged", async () => {
    const probe = createRealAuthProbe(async () => "valid");
    expect(await probe()).toBe("valid");
  });
});

describe("createRealAuthStateResolver — adversarial-review fix (2026-07-24): a real, non-constant-fail probe", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "eo-auth-probe-"));
    await mkdir(join(home, ".claude"), { recursive: true });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("resolves valid when CLAUDE_CODE_OAUTH_TOKEN is set, without touching the filesystem", async () => {
    const resolve = createRealAuthStateResolver({
      env: { CLAUDE_CODE_OAUTH_TOKEN: "a-real-looking-token-value" },
      homeDir: home,
    });
    expect(await resolve()).toBe("valid");
  });

  it("resolves missing when nothing is present at all", async () => {
    const resolve = createRealAuthStateResolver({ env: {}, homeDir: home });
    expect(await resolve()).toBe("missing");
  });

  it("resolves valid via the .eo-oauth-token handoff file when it exists at mode 0600", async () => {
    const tokenPath = join(home, ".claude", ".eo-oauth-token");
    await writeFile(tokenPath, "sk-ant-not-a-real-token-just-a-fixture\n", "utf8");
    await chmod(tokenPath, 0o600);
    const resolve = createRealAuthStateResolver({ env: {}, homeDir: home });
    expect(await resolve()).toBe("valid");
  });

  it("resolves invalid when the handoff file exists but has the wrong mode", async () => {
    const tokenPath = join(home, ".claude", ".eo-oauth-token");
    await writeFile(tokenPath, "sk-ant-not-a-real-token-just-a-fixture\n", "utf8");
    await chmod(tokenPath, 0o644);
    const resolve = createRealAuthStateResolver({ env: {}, homeDir: home });
    expect(await resolve()).toBe("invalid");
  });

  it("resolves valid via .credentials.json fallback when JSON-parseable at mode 0600", async () => {
    const credsPath = join(home, ".claude", ".credentials.json");
    await writeFile(credsPath, JSON.stringify({ accessToken: "not-a-real-token" }), "utf8");
    await chmod(credsPath, 0o600);
    const resolve = createRealAuthStateResolver({ env: {}, homeDir: home });
    expect(await resolve()).toBe("valid");
  });

  it("resolves invalid when .credentials.json is not valid JSON", async () => {
    const credsPath = join(home, ".claude", ".credentials.json");
    await writeFile(credsPath, "not json at all", "utf8");
    await chmod(credsPath, 0o600);
    const resolve = createRealAuthStateResolver({ env: {}, homeDir: home });
    expect(await resolve()).toBe("invalid");
  });

  it("never needs to return or expose the secret content itself to resolve a verdict", async () => {
    const tokenPath = join(home, ".claude", ".eo-oauth-token");
    const secretValue = "sk-ant-super-secret-fixture-value-12345";
    await writeFile(tokenPath, secretValue, "utf8");
    await chmod(tokenPath, 0o600);
    const resolve = createRealAuthStateResolver({ env: {}, homeDir: home });
    const state = await resolve();
    expect(state).toBe("valid");
    expect(typeof state).toBe("string");
    expect(state).not.toContain(secretValue);
  });
});
