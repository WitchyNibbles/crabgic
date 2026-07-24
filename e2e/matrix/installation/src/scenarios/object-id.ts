/**
 * Object-id resolution shared by every scenario. Real git repos use their
 * real `HEAD` commit id; fixtures with no commit yet (empty dir, invalid
 * `.git`, unborn HEAD) have no real Git object id to cite — `syntheticId`
 * is an explicitly-labeled, deterministic stand-in for those (still a
 * non-empty string, satisfying `EvidenceRecord.objectId`'s schema, but
 * documented here as NOT a real Git object id).
 */
import { createGitPlumbing, type GitPlumbing } from "@eo/git-engine";
import { digestArtifact } from "../evidence.js";

const plumbing: GitPlumbing = createGitPlumbing();

/** The real `HEAD` commit id of a real, committed repo at `dir`. */
export async function resolveHeadObjectId(dir: string): Promise<string> {
  const result = await plumbing.run(["rev-parse", "HEAD"], { cwd: dir });
  return result.stdout.trim();
}

/** A deterministic, explicitly-labeled stand-in object id for a scenario fixture with no real commit yet. */
export function syntheticObjectId(label: string): string {
  return `synthetic:${digestArtifact(label)}`;
}
