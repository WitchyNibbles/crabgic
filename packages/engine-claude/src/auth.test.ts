/// <reference types="node" />
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkerAuthError, buildWorkerEnv, provisionWorkerAuth } from "./auth.js";

/**
 * `auth` (roadmap/06-claude-engine-adapter.md §In scope, "Spawn path" auth
 * injection; docs/engine-baseline.md §1 auth decision record; README design
 * decision 3/4). Both recorded mechanisms are supported; the adapter never
 * chooses independently (roadmap/06 §Risks, risk 9).
 */

const SECRET_MARKER = "SUPER-SECRET-CREDENTIAL-BYTES-DO-NOT-LEAK";

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "eo-engine-claude-auth-"));
});

afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

describe("provisionWorkerAuth — credentialsFile", () => {
  it("copies the source file to <claudeConfigDir>/.credentials.json, mode 0600, byte-identical content", async () => {
    const sourcePath = join(scratchDir, "source-credentials.json");
    const claudeConfigDir = join(scratchDir, "claude-config");
    await writeFile(sourcePath, `{"marker":"${SECRET_MARKER}"}`, { mode: 0o600 });
    await mkdir(claudeConfigDir, { recursive: true });

    const result = await provisionWorkerAuth(
      { kind: "credentialsFile", sourcePath },
      claudeConfigDir,
    );

    expect(result).toEqual({});

    const destPath = join(claudeConfigDir, ".credentials.json");
    const destContent = await readFile(destPath, "utf8");
    const sourceContent = await readFile(sourcePath, "utf8");
    expect(destContent).toBe(sourceContent);

    const destStat = await stat(destPath);
    expect(destStat.mode & 0o777).toBe(0o600);
  });

  it("throws a typed WorkerAuthError when the source path is missing, message never contains the marker", async () => {
    const missingSourcePath = join(scratchDir, "does-not-exist.json");
    const claudeConfigDir = join(scratchDir, "claude-config-2");
    await mkdir(claudeConfigDir, { recursive: true });

    await expect(
      provisionWorkerAuth(
        { kind: "credentialsFile", sourcePath: missingSourcePath },
        claudeConfigDir,
      ),
    ).rejects.toBeInstanceOf(WorkerAuthError);

    try {
      await provisionWorkerAuth(
        { kind: "credentialsFile", sourcePath: missingSourcePath },
        claudeConfigDir,
      );
      expect.unreachable("expected provisionWorkerAuth to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerAuthError);
      expect((error as WorkerAuthError).message).not.toContain(SECRET_MARKER);
    }
  });

  it("throws a typed WorkerAuthError when the destination directory does not exist, message never contains the marker", async () => {
    const sourcePath = join(scratchDir, "source-credentials-2.json");
    await writeFile(sourcePath, `{"marker":"${SECRET_MARKER}"}`, { mode: 0o600 });
    const unwritableClaudeConfigDir = join(scratchDir, "nonexistent", "nested", "claude-config");

    try {
      await provisionWorkerAuth({ kind: "credentialsFile", sourcePath }, unwritableClaudeConfigDir);
      expect.unreachable("expected provisionWorkerAuth to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerAuthError);
      expect((error as WorkerAuthError).message).not.toContain(SECRET_MARKER);
    }
  });

  it("REFUSES a pre-planted symlink at the dest and does NOT write through it (Finding 5: credential TOCTOU / symlink-follow)", async () => {
    const sourcePath = join(scratchDir, "source-credentials-3.json");
    const claudeConfigDir = join(scratchDir, "claude-config-symlink");
    await mkdir(claudeConfigDir, { recursive: true });
    await writeFile(sourcePath, `{"marker":"${SECRET_MARKER}"}`, { mode: 0o600 });

    // A pre-planted symlink at the dest pointing at an attacker-chosen victim.
    const victimPath = join(scratchDir, "victim-owned-secret.json");
    await writeFile(victimPath, "PRE-EXISTING-VICTIM-CONTENT", { mode: 0o600 });
    const destPath = join(claudeConfigDir, ".credentials.json");
    await symlink(victimPath, destPath);

    await expect(
      provisionWorkerAuth({ kind: "credentialsFile", sourcePath }, claudeConfigDir),
    ).rejects.toBeInstanceOf(WorkerAuthError);

    // The symlink target must NOT have been written (no follow).
    expect(await readFile(victimPath, "utf8")).toBe("PRE-EXISTING-VICTIM-CONTENT");
    // The dest is still the symlink, never replaced/followed.
    expect((await lstat(destPath)).isSymbolicLink()).toBe(true);

    try {
      await provisionWorkerAuth({ kind: "credentialsFile", sourcePath }, claudeConfigDir);
      expect.unreachable("expected provisionWorkerAuth to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerAuthError);
      expect((error as WorkerAuthError).message).not.toContain(SECRET_MARKER);
    }
  });

  it("is IDEMPOTENT when the dest already holds a byte-identical regular file (resume/fork re-provision the SAME CLAUDE_CONFIG_DIR)", async () => {
    // 05 keys the per-worker CLAUDE_CONFIG_DIR by stable workerId, so
    // `resume`/`fork` re-run provisioning against the exact path the first
    // `spawn` already wrote `.credentials.json` into. Re-provisioning with the
    // same source must SUCCEED (return `{}`) and leave the file untouched —
    // NOT crash the credentialsFile auth path on every recovery.
    const sourcePath = join(scratchDir, "source-credentials-idempotent.json");
    const claudeConfigDir = join(scratchDir, "claude-config-idempotent");
    await mkdir(claudeConfigDir, { recursive: true });
    const sourceContent = `{"marker":"${SECRET_MARKER}"}`;
    await writeFile(sourcePath, sourceContent, { mode: 0o600 });

    // First provision (original spawn).
    await provisionWorkerAuth({ kind: "credentialsFile", sourcePath }, claudeConfigDir);
    const destPath = join(claudeConfigDir, ".credentials.json");
    expect(await readFile(destPath, "utf8")).toBe(sourceContent);

    // Second provision (resume/fork) against the now-present dest — no throw.
    const result = await provisionWorkerAuth(
      { kind: "credentialsFile", sourcePath },
      claudeConfigDir,
    );
    expect(result).toEqual({});
    expect(await readFile(destPath, "utf8")).toBe(sourceContent);
    expect((await stat(destPath)).mode & 0o777).toBe(0o600);
  });

  it("REFUSES a pre-existing regular file whose content differs from the source (tampering — never overwritten)", async () => {
    const sourcePath = join(scratchDir, "source-credentials-4.json");
    const claudeConfigDir = join(scratchDir, "claude-config-preexist");
    await mkdir(claudeConfigDir, { recursive: true });
    await writeFile(sourcePath, `{"marker":"${SECRET_MARKER}"}`, { mode: 0o600 });

    const destPath = join(claudeConfigDir, ".credentials.json");
    await writeFile(destPath, "PRE-EXISTING-DEST", { mode: 0o600 });

    await expect(
      provisionWorkerAuth({ kind: "credentialsFile", sourcePath }, claudeConfigDir),
    ).rejects.toBeInstanceOf(WorkerAuthError);

    // The pre-existing file must be left byte-identical (never overwritten).
    expect(await readFile(destPath, "utf8")).toBe("PRE-EXISTING-DEST");
  });
});

describe("provisionWorkerAuth — oauthToken", () => {
  it("returns CLAUDE_CODE_OAUTH_TOKEN and writes NO file", async () => {
    const claudeConfigDir = join(scratchDir, "claude-config-token");
    await mkdir(claudeConfigDir, { recursive: true });
    const token = `oauth-token-${SECRET_MARKER}`;

    const result = await provisionWorkerAuth({ kind: "oauthToken", token }, claudeConfigDir);

    expect(result).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: token });

    const destPath = join(claudeConfigDir, ".credentials.json");
    await expect(stat(destPath)).rejects.toThrow();
  });
});

describe("buildWorkerEnv", () => {
  it("builds a strict from-scratch allowlist: PATH, HOME, TMPDIR, TMP, CLAUDE_CONFIG_DIR, plus authEnv", () => {
    const env = buildWorkerEnv({
      hostPath: "/usr/bin:/bin",
      provisioning: {
        HOME: "/fixture/home",
        TMP: "/fixture/tmp",
        CLAUDE_CONFIG_DIR: "/fixture/claude-config",
      },
      authEnv: { CLAUDE_CODE_OAUTH_TOKEN: "token-fixture-value" },
    });

    expect(env).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/fixture/home",
      TMPDIR: "/fixture/tmp",
      TMP: "/fixture/tmp",
      CLAUDE_CONFIG_DIR: "/fixture/claude-config",
      CLAUDE_CODE_OAUTH_TOKEN: "token-fixture-value",
    });
  });

  it("produces exactly the allowlisted keys with an empty authEnv (credentialsFile path)", () => {
    const env = buildWorkerEnv({
      hostPath: "/usr/bin:/bin",
      provisioning: {
        HOME: "/fixture/home",
        TMP: "/fixture/tmp",
        CLAUDE_CONFIG_DIR: "/fixture/claude-config",
      },
      authEnv: {},
    });

    expect(Object.keys(env).sort()).toEqual(
      ["CLAUDE_CONFIG_DIR", "HOME", "PATH", "TMP", "TMPDIR"].sort(),
    );
  });
});
