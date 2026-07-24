/**
 * Real CLI driver — roadmap/23-release-hardening.md work item 3
 * ("Installation-matrix harness against 10 ... harness runs the REAL
 * installer logic"). Every scenario in this project drives the installer
 * through EXACTLY the public surface a real invocation of the
 * `engineering-orchestrator` binary uses: `parseCommand(argv)` builds a
 * `ParsedCommand` from argv tokens, `dispatchCommand(command, deps)` routes
 * it to the real `install`/`upgrade`/`uninstall` backend (only when
 * `deps.installer` is supplied — see `packages/cli/src/commands/
 * dispatch.ts`'s own doc comment). No internal, non-exported module of
 * `packages/cli`/`@eo/plugin` is imported anywhere in this project — every
 * import here is a name `engineering-orchestrator`/`@eo/plugin`/
 * `@eo/journal` actually exports from its public barrel.
 *
 * `CliDependencies.installer`'s own type (`InstallerDependencies`) is NOT
 * re-exported by `packages/cli`'s public barrel (`packages/cli/src/
 * index.ts` never names `./installer/types.js`) — this file supplies a
 * plain object literal shaped to match it structurally (TypeScript checks
 * the literal against the field's inferred type via `CliDependencies`
 * itself, which IS exported, without this file ever needing to name the
 * unexported interface). See this project's own report for why this is a
 * deliberate, documented choice rather than a missing-export gap: every
 * field `install`/`upgrade`/`uninstall` actually read
 * (`targetDir`/`pluginSourceDir`/`confirmGitInit`/`now`) is fully
 * discoverable from `roadmap/10-plugin-and-installer.md` and this
 * package's own doc comments, so the literal is not a guess.
 */
import { randomUUID } from "node:crypto";
import type { JournalStore } from "@eo/journal";
import { resolvePluginRoot } from "@eo/plugin";
import {
  dispatchCommand,
  parseCommand,
  type CliDependencies,
  type CommandResult,
} from "engineering-orchestrator";

/** Always resolves to the same on-disk `@eo/plugin` root every scenario shares — real package resolution (`resolvePluginRoot()`), never a synthetic fixture directory. */
export function pluginSourceDir(): string {
  return resolvePluginRoot();
}

export interface BuildCliDependenciesOptions {
  readonly targetDir: string;
  readonly journal: JournalStore;
  /** Defaults to `async () => false` — the installation matrix never wants an accidental real `git init`; scenarios that specifically test the approval gate override this explicitly. */
  readonly confirmGitInit?: () => Promise<boolean>;
  /** Injectable clock seam, mirrors `InstallerDependencies.now`'s own optionality. */
  readonly now?: () => string;
}

/**
 * Builds a real `CliDependencies` object with a real `installer` bag wired
 * to `targetDir` — `connectClient` is a stub that REJECTS loudly (never
 * silently succeeds) because `install`/`upgrade`/`uninstall` dispatch never
 * calls it (`packages/cli/src/commands/dispatch.ts`'s own switch); if a
 * future regression ever routed one of these commands through it, this
 * harness would fail loudly rather than passing on an unexercised path.
 */
export function buildCliDependencies(options: BuildCliDependenciesOptions): CliDependencies {
  return {
    connectClient: () =>
      Promise.reject(
        new Error(
          "installation-matrix harness: connectClient must never be invoked by install/upgrade/uninstall dispatch",
        ),
      ),
    journal: options.journal,
    projectHash: `e2e-installation-matrix-${randomUUID()}`,
    installer: {
      targetDir: options.targetDir,
      pluginSourceDir: pluginSourceDir(),
      confirmGitInit: options.confirmGitInit ?? (() => Promise.resolve(false)),
      ...(options.now !== undefined ? { now: options.now } : {}),
    },
  };
}

/** Parses `argv` and dispatches it against `deps` — the exact `parseCommand` -> `dispatchCommand` pipeline `packages/cli/src/bin.ts` itself drives. */
export async function runCli(
  argv: readonly string[],
  deps: CliDependencies,
): Promise<CommandResult> {
  const command = parseCommand(argv);
  return dispatchCommand(command, deps);
}

/**
 * Runs `argv` with `--json` appended and parses `result.stdout` as JSON,
 * returning it as `T` — the same wire contract a real `--json` invocation
 * of the binary produces (`packages/cli/src/output/format.ts`'s
 * `formatJson`). `T` is this project's OWN minimal structural description
 * of each command's JSON shape (see `scenario-types.ts`), never a reach
 * into `packages/cli`'s unexported result types.
 */
export async function runCliJson<T>(
  argv: readonly string[],
  deps: CliDependencies,
): Promise<{ readonly exitCode: number; readonly result: T }> {
  const commandResult = await runCli([...argv, "--json"], deps);
  if (commandResult.stdout === undefined) {
    throw new Error(
      `installation-matrix harness: expected --json stdout for "${argv.join(" ")}", got none (stderr: ${commandResult.stderr ?? "<none>"})`,
    );
  }
  return { exitCode: commandResult.exitCode, result: JSON.parse(commandResult.stdout) as T };
}
