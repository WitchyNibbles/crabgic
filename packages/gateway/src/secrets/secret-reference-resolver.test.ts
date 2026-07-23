import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSecretReference, SecretResolutionError } from "./secret-reference-resolver.js";

describe("resolveSecretReference — env backend", () => {
  const VAR_NAME = "EO_GATEWAY_TEST_SECRET_ENV";

  afterEach(() => {
    delete process.env[VAR_NAME];
  });

  it("resolves a set, non-empty env var", async () => {
    process.env[VAR_NAME] = "super-secret-token";
    const value = await resolveSecretReference({ backend: "env", variable: VAR_NAME });
    expect(value).toBe("super-secret-token");
  });

  it("rejects an unset env var", async () => {
    delete process.env[VAR_NAME];
    await expect(
      resolveSecretReference({ backend: "env", variable: VAR_NAME }),
    ).rejects.toBeInstanceOf(SecretResolutionError);
  });

  it("rejects an empty-string env var", async () => {
    process.env[VAR_NAME] = "";
    await expect(
      resolveSecretReference({ backend: "env", variable: VAR_NAME }),
    ).rejects.toThrow(/unset or empty/);
  });
});

describe("resolveSecretReference — file backend", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eo-gateway-secret-file-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("resolves a 0600 file's trimmed contents", async () => {
    const path = join(dir, "token");
    await writeFile(path, "  file-secret-value  \n");
    await chmod(path, 0o600);
    const value = await resolveSecretReference({ backend: "file", path });
    expect(value).toBe("file-secret-value");
  });

  it("refuses a file with a looser mode (0644)", async () => {
    const path = join(dir, "token-loose");
    await writeFile(path, "value");
    await chmod(path, 0o644);
    await expect(resolveSecretReference({ backend: "file", path })).rejects.toThrow(/0600/);
  });

  it("rejects a missing file", async () => {
    await expect(
      resolveSecretReference({ backend: "file", path: join(dir, "does-not-exist") }),
    ).rejects.toBeInstanceOf(SecretResolutionError);
  });

  it("rejects an empty 0600 file", async () => {
    const path = join(dir, "empty");
    await writeFile(path, "");
    await chmod(path, 0o600);
    await expect(resolveSecretReference({ backend: "file", path })).rejects.toThrow(/empty/);
  });
});

describe("resolveSecretReference — exec backend", () => {
  it("resolves a command's trimmed stdout", async () => {
    const value = await resolveSecretReference({
      backend: "exec",
      command: process.execPath,
      args: ["-e", "process.stdout.write('exec-secret-value\\n')"],
    });
    expect(value).toBe("exec-secret-value");
  });

  it("rejects a failing command without leaking stderr content", async () => {
    await expect(
      resolveSecretReference({
        backend: "exec",
        command: process.execPath,
        args: ["-e", "process.exit(1)"],
      }),
    ).rejects.toBeInstanceOf(SecretResolutionError);
  });

  it("rejects a command producing no output", async () => {
    await expect(
      resolveSecretReference({
        backend: "exec",
        command: process.execPath,
        args: ["-e", "process.stdout.write('')"],
      }),
    ).rejects.toThrow(/no output/);
  });

  it("rejects an unresolvable command", async () => {
    await expect(
      resolveSecretReference({ backend: "exec", command: "eo-gateway-nonexistent-command-xyz" }),
    ).rejects.toBeInstanceOf(SecretResolutionError);
  });
});
