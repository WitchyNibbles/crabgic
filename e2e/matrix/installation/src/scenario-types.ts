/**
 * Structural (duck-typed) descriptions of each installer command's `--json`
 * wire shape — deliberately NOT imported from `packages/cli`'s internal
 * `InstallResult`/`UpgradeResult`/`UninstallResult` types (those are not
 * re-exported by its public barrel; see `cli-driver.ts`'s file-level doc
 * comment). These interfaces describe exactly the fields this project's
 * own scenarios read off real `--json` output — the same contract a real
 * external consumer of the CLI's `--json` flag would rely on.
 */

export interface InstallJsonResult {
  readonly status: "installed" | "already-installed" | "dry-run" | "aborted-git-init-declined";
  readonly repoState: "not-a-repo" | "invalid-git" | "unborn-head" | "clean" | "dirty";
  readonly monorepoDetected: boolean;
  readonly gitInitPerformed: boolean;
  readonly diff: readonly { readonly relPath: string; readonly action: string }[];
}

export interface UpgradeJsonResult {
  readonly status: "upgraded" | "up-to-date" | "dry-run" | "not-installed";
  readonly diff: readonly { readonly relPath: string; readonly action: string }[];
  readonly recoveredFromInterruptedUpgrade: boolean;
}

export interface UninstallJsonResult {
  readonly status: "uninstalled" | "not-installed";
  readonly outcomes: readonly {
    readonly relPath: string;
    readonly action: "removed" | "restored" | "preserved-drifted" | "already-absent";
  }[];
}

/** One normalized scenario outcome, shared across every scenario file — what `evidence.ts` turns into an `EvidenceRecord` and what each scenario's own test asserts on. */
export interface ScenarioOutcome {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
  /** The exact Git object id (or a deterministic stand-in for scenarios with no natural one — see each scenario's own doc comment) this outcome was captured against. */
  readonly objectId: string;
}
