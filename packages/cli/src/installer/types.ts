import type { EnvelopePolicy } from "@crabgic/contracts";
import type { DerivedPolicy } from "../policy/derive-policy.js";
import type { LoadPolicyResult } from "../policy/policy-store.js";

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
  /** The plugin package's own root directory (`@crabgic/plugin`'s `resolvePluginRoot()` in real usage) — the source of `skills/`, `agents/`, `hooks/` this installer copies/reads from. */
  readonly pluginSourceDir: string;
  /** `git init` in a non-git `targetDir` runs ONLY after this resolves `true` (roadmap/10 §In scope, "Non-Git projects"). Never called for any other repo state. */
  readonly confirmGitInit: () => Promise<boolean>;
  /** Clock seam — defaults to `() => new Date().toISOString()`. */
  readonly now?: () => string;
  /**
   * The standing-approval bootstrap (ledger Gap 18; roadmap/10's 2026-07-28
   * scope amendment). OPTIONAL for the same reason the whole bag is: every
   * pre-existing installer test builds an `InstallerDependencies` without it
   * and must keep observing the exact same artifact set.
   *
   * The policy is NOT an ordinary installer artifact. It lands in the
   * project's XDG **state** root at `0600`, never in the repo — a standing
   * grant that could be committed would be a standing grant every clone of
   * the repository carried.
   */
  readonly policy?: PolicyInstallDependencies;
}

export interface PolicyInstallDependencies {
  /** Absolute path the policy is written to (`resolveEnvelopePolicyPath` in real usage). */
  readonly path: string;
  /**
   * Whether a policy ALREADY exists at `path` (`loadEnvelopePolicy` in real
   * usage). REQUIRED, not optional: review 2026-07-30 found `install`
   * renamed a freshly-derived policy over the existing file, wiping every
   * hand-added grant — network, credential and remote grants are never
   * derived, so they exist only by hand. An existing policy is the owner's
   * file; install keeps it (valid → kept untouched; invalid → refused with
   * its own reason, never silently replaced).
   */
  readonly loadExisting: () => LoadPolicyResult;
  /** Derives the candidate from the repository. Injected so tests need no real tree. */
  readonly derive: () => DerivedPolicy;
  /**
   * Renders the candidate and returns the owner's decision.
   *
   * A human act by construction, exactly like `confirmGitInit`. Nothing
   * reachable from a manager session may reach this — ledger Gap 18 part 3 —
   * so it is supplied only by the interactive `install` path and is never
   * defaulted to `true`.
   */
  readonly confirm: (policy: DerivedPolicy) => Promise<boolean>;
  /** Writes the confirmed policy `0600`. Separate from `confirm` so a decline can never reach a writer. */
  readonly write: (path: string, policy: EnvelopePolicy) => Promise<void>;
}
