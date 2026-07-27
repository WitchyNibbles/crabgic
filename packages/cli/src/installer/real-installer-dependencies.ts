/**
 * Real (non-test) `InstallerDependencies` wiring — factored out of
 * `../bootstrap.ts` the same way that module already factors out the rest
 * of `CliDependencies`, so it stays independently unit-testable.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";
import type { InstallerDependencies } from "./types.js";

/**
 * Resolves the directory holding the plugin's distributable assets — the
 * subagents, hooks, skills, `.mcp.json` and `.claude-plugin/marketplace.json`
 * that `install` copies into a project and `doctor` verifies.
 *
 * TWO LAYOUTS, AND THE PUBLISHED ONE COMES FIRST.
 *
 * In the published package the assets sit beside the bundle at
 * `<dist>/plugin`, copied there by `scripts/bundle-cli.mjs`. In this
 * monorepo they live in the `@crabgic/plugin` workspace package, reachable by
 * ordinary module resolution.
 *
 * This used to try only the second, on the stated assumption that it "works
 * identically whether `@crabgic/plugin` is a workspace symlink (dev) or a
 * real published dependency". That assumption was false in the only case
 * that matters: `@crabgic/plugin` is `private: true` and is never published,
 * so a real install has no such module. 1.0.0 shipped with `crabgic doctor`
 * failing in any consuming repo with `Cannot find module
 * '@crabgic/plugin/package.json'`, and `crabgic install` — the command an
 * operator installs this package FOR — equally dead.
 *
 * The published layout is checked first because it is the one real users
 * have; the workspace fallback keeps development and the e2e harnesses
 * working unchanged.
 */
export function resolvePluginSourceDir(fromUrl: string = import.meta.url): string {
  const bundled = join(dirname(fileURLToPath(fromUrl)), "plugin");
  if (existsSync(join(bundled, ".claude-plugin", "marketplace.json"))) return bundled;

  const require = createRequire(fromUrl);
  const packageJsonPath = require.resolve("@crabgic/plugin/package.json");
  return dirname(packageJsonPath);
}

/** Reads one line of confirmation from `input`; resolves `true` only for an exact (trimmed, case-insensitive) "yes" — the same convention `../approval/prompt.ts` uses for its own human-only gate. */
function readYesConfirmation(input: Readable): Promise<boolean> {
  return new Promise((resolve) => {
    let buffer = "";
    function onData(chunk: Buffer | string): void {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (buffer.includes("\n")) {
        input.off("data", onData);
        resolve(buffer.split("\n")[0]!.trim().toLowerCase() === "yes");
      }
    }
    input.on("data", onData);
  });
}

/** The real, interactive `confirmGitInit` — prompts on `output`, reads a line from `input`. Never runs `git init` itself; only decides whether `install` is allowed to. */
export function createRealConfirmGitInit(io: {
  readonly input: Readable;
  readonly output: Writable;
}): () => Promise<boolean> {
  return async () => {
    io.output.write(
      'This directory is not a git repository. Run "git init" so the Crabgic ' +
        'can track its own control repo/worktrees?\nType "yes" to proceed, anything else to abort: ',
    );
    return readYesConfirmation(io.input);
  };
}

export interface BuildRealInstallerDependenciesOverrides {
  readonly pluginSourceDir?: string;
  readonly confirmGitInit?: () => Promise<boolean>;
}

export function buildRealInstallerDependencies(
  targetDir: string,
  overrides: BuildRealInstallerDependenciesOverrides = {},
): InstallerDependencies {
  return {
    targetDir,
    pluginSourceDir: overrides.pluginSourceDir ?? resolvePluginSourceDir(),
    confirmGitInit:
      overrides.confirmGitInit ??
      createRealConfirmGitInit({ input: process.stdin, output: process.stdout }),
  };
}
