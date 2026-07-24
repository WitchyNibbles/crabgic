import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  buildRealInstallerDependencies,
  createRealConfirmGitInit,
  resolvePluginSourceDir,
} from "./real-installer-dependencies.js";

describe("resolvePluginSourceDir", () => {
  it("resolves @eo/plugin's real installed root directory via Node module resolution", () => {
    const dir = resolvePluginSourceDir();
    expect(dir).toMatch(/plugin$/);
  });
});

describe("createRealConfirmGitInit", () => {
  it('resolves true for an exact "yes" (case-insensitive, trimmed)', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const confirm = createRealConfirmGitInit({ input, output });
    const promise = confirm();
    input.write("YES\n");
    expect(await promise).toBe(true);
  });

  it("resolves false for anything else", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const confirm = createRealConfirmGitInit({ input, output });
    const promise = confirm();
    input.write("no thanks\n");
    expect(await promise).toBe(false);
  });

  it("writes a prompt to output before reading", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (c: Buffer) => chunks.push(c.toString("utf8")));
    const confirm = createRealConfirmGitInit({ input, output });
    const promise = confirm();
    expect(chunks.join("")).toContain("git init");
    input.write("yes\n");
    await promise;
  });
});

describe("buildRealInstallerDependencies", () => {
  it("uses the real resolvePluginSourceDir and a real confirmGitInit by default", () => {
    const deps = buildRealInstallerDependencies("/some/target/dir");
    expect(deps.targetDir).toBe("/some/target/dir");
    expect(deps.pluginSourceDir).toMatch(/plugin$/);
    expect(typeof deps.confirmGitInit).toBe("function");
  });

  it("honors explicit overrides", () => {
    const deps = buildRealInstallerDependencies("/some/target/dir", {
      pluginSourceDir: "/custom/plugin",
      confirmGitInit: async () => true,
    });
    expect(deps.pluginSourceDir).toBe("/custom/plugin");
  });
});
