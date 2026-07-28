/**
 * `install [--dry-run] [--json]` backend — roadmap/10-plugin-and-installer.md
 * work item 4: "backend across the installation matrix (empty dir, invalid
 * `.git`, unborn HEAD, dirty repo, monorepo) + non-Git `git init`-after-
 * approval gate." File-writing is entirely independent of git health (none
 * of `CLAUDE.md`/`settings.json`/`.mcp.json`/`eo-*.md` needs a working
 * repo) — `../git-repo-state.ts`'s detection is purely informational
 * except for the one `not-a-repo` case, which gates the ONLY git-touching
 * action (`git init`) behind explicit approval. This function never runs
 * `git add`/`git commit` under any circumstance — "never sweep ignored
 * files/secrets into a first commit" is satisfied by never committing
 * anything here at all, ever.
 */
import type { EnvelopePolicy } from "@crabgic/contracts";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { computeContentDigest, ENABLED_PLUGIN_KEY } from "@crabgic/plugin";
import { loadSubagentFilesToInstall } from "./agents-writer.js";
import { computeChecksum } from "./checksum.js";
import { mergeClaudeMd } from "./claude-md.js";
import {
  detectGitRepoState,
  detectMonorepo,
  performGitInit,
  type GitRepoState,
} from "./git-repo-state.js";
import { mergeMcpJson } from "./mcp-json-merge.js";
import { mergeSettingsJson } from "./settings-merge.js";
import { loadStatusLineFileToInstall } from "./statusline-writer.js";
import {
  atomicWriteFile,
  readInstallState,
  writeInstallState,
  type ArtifactRecord,
  type InstallState,
} from "./state-store.js";
import type { InstallerDependencies } from "./types.js";

/**
 * The `enabledPlugins` key this installer writes — LIVE-VERIFIED (2026-07-
 * 24, `@crabgic/plugin`'s `ENABLED_PLUGIN_KEY` own doc comment) against a real
 * `claude` binary to be `<plugin-name>@<marketplace-name>`, NOT the bare
 * plugin name alone. Re-exported under this package's own established name
 * so existing call sites/tests didn't need renaming.
 */
export const INSTALLER_PLUGIN_NAME = ENABLED_PLUGIN_KEY;

export interface InstallOptions {
  readonly dryRun: boolean;
}

export interface ArtifactDiffEntry {
  readonly relPath: string;
  readonly action: "create" | "update" | "unchanged";
}

export type InstallStatus =
  "installed" | "already-installed" | "dry-run" | "aborted-git-init-declined";

/**
 * What happened to the standing `EnvelopePolicy` during this install (ledger
 * Gap 18). Reported rather than folded into `status`, because none of these
 * outcomes makes the INSTALL itself a failure: a project with no policy has a
 * working plugin whose dispatches refuse until one exists, which is the
 * correct fail-closed posture.
 */
export type PolicyInstallOutcome =
  /** No policy bag was supplied — every pre-existing caller, and the shape they keep observing. */
  | { readonly status: "not-configured" }
  /** Derivation found nothing to grant. Writing it would have produced a green install, a green doctor, and a product that never runs. */
  | { readonly status: "vacuous" }
  | { readonly status: "dry-run"; readonly policy: EnvelopePolicy }
  /** The owner read the candidate and said no. Not an error. */
  | { readonly status: "declined" }
  | { readonly status: "written"; readonly policy: EnvelopePolicy };

export interface InstallResult {
  readonly status: InstallStatus;
  readonly repoState: GitRepoState;
  readonly monorepoDetected: boolean;
  readonly gitInitPerformed: boolean;
  readonly diff: readonly ArtifactDiffEntry[];
  /** Absent only for callers that supplied no policy bag at all. */
  readonly policy?: PolicyInstallOutcome;
}

export async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export interface DesiredArtifact {
  readonly relPath: string;
  readonly content: string;
  readonly kind: "merged" | "full";
  /** Only meaningful for `kind: "merged"` — see `ArtifactRecord.originalContent`. */
  readonly originalContent?: string;
}

/**
 * Resolves what "the artifact's content before this installer ever touched
 * it" means for `relPath`: the FIRST time this installer ever ran, that is
 * whatever is on disk right now (before this run's own merge/write); on
 * every subsequent (re-)install, it is whatever `previousState` already
 * recorded — NEVER re-captured from the current on-disk content, which by
 * then already carries this installer's own managed block. Getting this
 * wrong would make `uninstall` "restore" a snapshot that still contains
 * this installer's own content.
 */
function resolveOriginalContent(
  previousState: InstallState | undefined,
  relPath: string,
  currentOnDisk: string | undefined,
): string | undefined {
  const previousRecord = previousState?.artifacts.find((a) => a.relPath === relPath);
  return previousRecord !== undefined ? previousRecord.originalContent : currentOnDisk;
}

export async function buildDesiredArtifacts(
  deps: InstallerDependencies,
  previousState: InstallState | undefined,
): Promise<readonly DesiredArtifact[]> {
  const hasAgentsMd = existsSync(join(deps.targetDir, "AGENTS.md"));
  const existingClaudeMd = await readTextIfExists(join(deps.targetDir, "CLAUDE.md"));
  const claudeMd = mergeClaudeMd(existingClaudeMd, hasAgentsMd);

  const existingSettingsRaw = await readTextIfExists(
    join(deps.targetDir, ".claude", "settings.json"),
  );
  const existingSettings: Record<string, unknown> =
    existingSettingsRaw !== undefined ? JSON.parse(existingSettingsRaw) : {};
  const settings = mergeSettingsJson(existingSettings, INSTALLER_PLUGIN_NAME);

  const existingMcpRaw = await readTextIfExists(join(deps.targetDir, ".mcp.json"));
  const existingMcp: Record<string, unknown> =
    existingMcpRaw !== undefined ? JSON.parse(existingMcpRaw) : {};
  const mcp = mergeMcpJson(existingMcp);

  const subagentFiles = await loadSubagentFilesToInstall(deps.pluginSourceDir);
  const statusLineFile = await loadStatusLineFileToInstall(deps.pluginSourceDir);

  const claudeMdOriginal = resolveOriginalContent(previousState, "CLAUDE.md", existingClaudeMd);
  const settingsRelPath = join(".claude", "settings.json");
  const settingsOriginal = resolveOriginalContent(
    previousState,
    settingsRelPath,
    existingSettingsRaw,
  );
  const mcpOriginal = resolveOriginalContent(previousState, ".mcp.json", existingMcpRaw);

  return [
    {
      relPath: "CLAUDE.md",
      content: claudeMd.content,
      kind: "merged",
      ...(claudeMdOriginal !== undefined ? { originalContent: claudeMdOriginal } : {}),
    },
    {
      relPath: settingsRelPath,
      content: `${JSON.stringify(settings.settings, null, 2)}\n`,
      kind: "merged",
      ...(settingsOriginal !== undefined ? { originalContent: settingsOriginal } : {}),
    },
    {
      relPath: ".mcp.json",
      content: `${JSON.stringify(mcp.mcpJson, null, 2)}\n`,
      kind: "merged",
      ...(mcpOriginal !== undefined ? { originalContent: mcpOriginal } : {}),
    },
    ...subagentFiles.map((f) => ({
      relPath: f.relPath,
      content: f.content,
      kind: "full" as const,
    })),
    {
      relPath: statusLineFile.relPath,
      content: statusLineFile.content,
      kind: "full" as const,
    },
  ];
}

/** Runs a full install (or a `--dry-run` preview of one) against `deps.targetDir`. Idempotent: running twice produces `action: "unchanged"` for every artifact the second time. */
export async function runInstall(
  deps: InstallerDependencies,
  options: InstallOptions,
): Promise<InstallResult> {
  const repoState = await detectGitRepoState(deps.targetDir);
  const monorepoDetected = detectMonorepo(deps.targetDir);
  let gitInitPerformed = false;

  if (repoState === "not-a-repo") {
    const approved = await deps.confirmGitInit();
    if (!approved) {
      return {
        status: "aborted-git-init-declined",
        repoState,
        monorepoDetected,
        gitInitPerformed: false,
        diff: [],
      };
    }
    if (!options.dryRun) {
      await performGitInit(deps.targetDir);
      gitInitPerformed = true;
    }
  }

  const previousState = await readInstallState(deps.targetDir);
  const desired = await buildDesiredArtifacts(deps, previousState);
  const diff: ArtifactDiffEntry[] = [];
  const artifacts: ArtifactRecord[] = [];
  const sourceDigest = computeContentDigest(deps.pluginSourceDir);
  const sourceVersion = "0.0.0";

  for (const artifact of desired) {
    const targetPath = join(deps.targetDir, artifact.relPath);
    const currentOnDisk = await readTextIfExists(targetPath);
    const action: ArtifactDiffEntry["action"] =
      currentOnDisk === undefined
        ? "create"
        : currentOnDisk === artifact.content
          ? "unchanged"
          : "update";
    diff.push({ relPath: artifact.relPath, action });

    if (!options.dryRun && action !== "unchanged") {
      await atomicWriteFile(targetPath, artifact.content);
    }

    artifacts.push({
      relPath: artifact.relPath,
      kind: artifact.kind,
      installedChecksum: computeChecksum(artifact.content),
      sourceVersion,
      ...(artifact.originalContent !== undefined
        ? { originalContent: artifact.originalContent }
        : {}),
    });
  }

  // THE STANDING-APPROVAL BOOTSTRAP (ledger Gap 18; roadmap/10's 2026-07-28
  // scope amendment). Deliberately after the artifact loop and before the
  // install state is recorded: the policy is not an artifact of the repo — it
  // lands in the project's XDG state root, because a standing grant that
  // could be committed would be a standing grant every clone carried.
  //
  // A dry run derives and reports, and writes nothing, exactly like every
  // other artifact above.
  const policyOutcome = await bootstrapPolicy(deps, options.dryRun);

  if (options.dryRun) {
    return {
      status: "dry-run",
      repoState,
      monorepoDetected,
      gitInitPerformed,
      diff,
      policy: policyOutcome,
    };
  }

  const state: InstallState = {
    schemaVersion: 1,
    installedAt: (deps.now ?? (() => new Date().toISOString()))(),
    sourceVersion,
    sourceDigest,
    artifacts,
  };
  await writeInstallState(deps.targetDir, state);

  const allUnchanged = diff.every((d) => d.action === "unchanged");
  return {
    status: allUnchanged ? "already-installed" : "installed",
    repoState,
    monorepoDetected,
    gitInitPerformed,
    diff,
    policy: policyOutcome,
  };
}

/**
 * Derives, renders and (on confirmation) writes the project's standing
 * `EnvelopePolicy`.
 *
 * REFUSES TO WRITE A VACUOUS ONE. Roast round 1 (F9): an all-empty policy
 * passes every structural check a doctor can make — it exists, it parses, it
 * is 0600, it is untracked — while refusing every dispatch, so an owner would
 * see a green install and a green doctor and a product that never runs. A
 * repo with no recognisable source directory derives exactly that, and the
 * honest answer is to say so rather than to write it.
 *
 * A DECLINE IS NOT AN ERROR. Installing without a policy leaves a working
 * plugin whose dispatches refuse until one exists, which is the correct
 * fail-closed posture — not a half-installed project.
 */
async function bootstrapPolicy(
  deps: InstallerDependencies,
  dryRun: boolean,
): Promise<PolicyInstallOutcome> {
  if (deps.policy === undefined) return { status: "not-configured" };

  const derived = deps.policy.derive();
  if (derived.vacuous) {
    return { status: "vacuous" };
  }
  if (dryRun) {
    return { status: "dry-run", policy: derived.policy };
  }
  if (!(await deps.policy.confirm(derived))) {
    return { status: "declined" };
  }
  await deps.policy.write(deps.policy.path, derived.policy);
  return { status: "written", policy: derived.policy };
}
