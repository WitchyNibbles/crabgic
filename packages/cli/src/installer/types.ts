/**
 * `install`/`upgrade`/`uninstall`'s own dependency bag — kept OPTIONAL on
 * `CliDependencies` (`../commands/types.ts`) rather than mandatory, so
 * every pre-existing roadmap/09 test (which builds a `CliDependencies`
 * without any installer wiring at all) keeps compiling and keeps observing
 * the typed `NOT_IMPLEMENTED` shape for `install`/`upgrade`/`uninstall`
 * unchanged — this phase's own real backend only activates when a caller
 * (this phase's own tests, `../bootstrap.ts`'s real wiring) supplies it.
 */
export interface InstallerDependencies {
  /** The target project's root directory (where `CLAUDE.md`, `.claude/`, `.mcp.json` live). */
  readonly targetDir: string;
  /** The plugin package's own root directory (`@eo/plugin`'s `resolvePluginRoot()` in real usage) — the source of `skills/`, `agents/`, `hooks/` this installer copies/reads from. */
  readonly pluginSourceDir: string;
  /** `git init` in a non-git `targetDir` runs ONLY after this resolves `true` (roadmap/10 §In scope, "Non-Git projects"). Never called for any other repo state. */
  readonly confirmGitInit: () => Promise<boolean>;
  /** Clock seam — defaults to `() => new Date().toISOString()`. */
  readonly now?: () => string;
}
