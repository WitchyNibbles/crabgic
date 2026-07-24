/**
 * `uninstall [--keep-state]` backend — roadmap/10-plugin-and-installer.md
 * work item 6: "preserves user edits, removes only unchanged owned
 * content." Work item 6's first failing test: "uninstall over a file with
 * a user edit deletes the user's edit under the stub" — this real
 * implementation checks each tracked artifact against `../drift-
 * detector.ts` FIRST; a drifted (user-edited) artifact is left entirely
 * untouched.
 *
 * For an unchanged (non-drifted) artifact: a `"full"`-owned file (the
 * copied `eo-*.md` subagents) is simply deleted; a `"merged"` file
 * (`CLAUDE.md`/`settings.json`/`.mcp.json`) is restored to its own recorded
 * `originalContent` snapshot (or deleted, if it did not exist before this
 * installer ever touched it) — the simplest correct way to remove only
 * this installer's own content without having to reverse-engineer which
 * JSON keys/text spans it added.
 */
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { detectDrift } from "./drift-detector.js";
import { readInstallState, removeInstallState, type InstallState } from "./state-store.js";

export interface UninstallOptions {
  readonly keepState: boolean;
}

export interface UninstallArtifactOutcome {
  readonly relPath: string;
  readonly action: "removed" | "restored" | "preserved-drifted" | "already-absent";
}

export type UninstallStatus = "uninstalled" | "not-installed";

export interface UninstallResult {
  readonly status: UninstallStatus;
  readonly outcomes: readonly UninstallArtifactOutcome[];
}

async function uninstallOneArtifact(
  targetDir: string,
  artifact: InstallState["artifacts"][number],
  isDrifted: boolean,
): Promise<UninstallArtifactOutcome> {
  const targetPath = join(targetDir, artifact.relPath);

  if (isDrifted) {
    // A user edit is present — never touch it (roadmap/10 §Test plan,
    // Integration: "uninstall-preserving-edits").
    return { relPath: artifact.relPath, action: "preserved-drifted" };
  }

  const removeOrReportAbsent = async (): Promise<UninstallArtifactOutcome> => {
    try {
      await rm(targetPath);
      return { relPath: artifact.relPath, action: "removed" };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { relPath: artifact.relPath, action: "already-absent" };
      }
      throw err;
    }
  };

  if (artifact.kind === "full" || artifact.originalContent === undefined) {
    return removeOrReportAbsent();
  }

  await writeFile(targetPath, artifact.originalContent, "utf8");
  return { relPath: artifact.relPath, action: "restored" };
}

/** Uninstalls every tracked, unchanged artifact; preserves anything the user has since edited. Removes the state store itself unless `options.keepState`. */
export async function runUninstall(
  targetDir: string,
  options: UninstallOptions,
): Promise<UninstallResult> {
  const state = await readInstallState(targetDir);
  if (state === undefined) {
    return { status: "not-installed", outcomes: [] };
  }

  const driftFindings = await detectDrift(targetDir, state);
  const driftedPaths = new Set(
    driftFindings.filter((f) => f.kind === "modified").map((f) => f.relPath),
  );

  const outcomes: UninstallArtifactOutcome[] = [];
  for (const artifact of state.artifacts) {
    outcomes.push(
      await uninstallOneArtifact(targetDir, artifact, driftedPaths.has(artifact.relPath)),
    );
  }

  if (!options.keepState) {
    await removeInstallState(targetDir);
  }

  return { status: "uninstalled", outcomes };
}
