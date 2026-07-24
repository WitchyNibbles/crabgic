/**
 * Real (non-test) `InstallerDependencies` wiring — factored out of
 * `../bootstrap.ts` the same way that module already factors out the rest
 * of `CliDependencies`, so it stays independently unit-testable.
 */
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { InstallerDependencies } from "./types.js";

/** Resolves `@eo/plugin`'s own installed root directory via real Node module resolution — works identically whether `@eo/plugin` is a workspace symlink (dev) or a real published dependency (a real install). */
export function resolvePluginSourceDir(fromUrl: string = import.meta.url): string {
  const require = createRequire(fromUrl);
  const packageJsonPath = require.resolve("@eo/plugin/package.json");
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
      'This directory is not a git repository. Run "git init" so the Engineering Orchestrator ' +
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
