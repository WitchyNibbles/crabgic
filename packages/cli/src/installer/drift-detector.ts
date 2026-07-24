/**
 * Drift detector — roadmap/10-plugin-and-installer.md exit criterion:
 * "Drift detector flags every seeded single-artifact mutation across
 * `CLAUDE.md`, `settings.json`, `.mcp.json`, and `eo-*.md` — fixture suite
 * `drift.fixtures`." Work item 3's first failing test: "a single-byte
 * external mutation of an owned file goes undetected by a stub detector."
 * Whole-file checksum comparison (§Test plan, Unit: "checksum/drift hash
 * stability across line-ending normalization") — any external change to a
 * tracked artifact (a merged file's own managed block OR a fully-owned
 * file) is flagged; distinguishing "user's own region" from "our region"
 * within a merged file is `../upgrade.ts`'s/`../uninstall.ts`'s own
 * preserve-vs-overwrite concern, not this detector's.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { computeChecksum } from "./checksum.js";
import type { ArtifactRecord, InstallState } from "./state-store.js";

export interface DriftFinding {
  readonly relPath: string;
  readonly kind: "missing" | "modified";
}

/** Recomputes every tracked artifact's current checksum and compares it to `state`'s recorded `installedChecksum`. A file that no longer exists at all is `"missing"`; a file whose content checksum no longer matches is `"modified"`. An unchanged file produces no finding. */
export async function detectDrift(
  targetDir: string,
  state: InstallState,
): Promise<readonly DriftFinding[]> {
  const findings: DriftFinding[] = [];
  for (const artifact of state.artifacts) {
    const finding = await checkOneArtifact(targetDir, artifact);
    if (finding !== undefined) findings.push(finding);
  }
  return findings;
}

async function checkOneArtifact(
  targetDir: string,
  artifact: ArtifactRecord,
): Promise<DriftFinding | undefined> {
  let content: string;
  try {
    content = await readFile(join(targetDir, artifact.relPath), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { relPath: artifact.relPath, kind: "missing" };
    }
    throw err;
  }
  return computeChecksum(content) === artifact.installedChecksum
    ? undefined
    : { relPath: artifact.relPath, kind: "modified" };
}
