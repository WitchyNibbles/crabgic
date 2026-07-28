import { readdirSync } from "node:fs";

/**
 * The directory entries directly under `projectDir`.
 *
 * A seam of its own so `derivePolicy` stays a pure function of a listing —
 * its tests need no real tree, and the one place that touches the filesystem
 * is this four-line function. Failure is an empty listing rather than a
 * throw: derivation then reports the policy as vacuous, which is exactly the
 * right answer for a directory that cannot be read, and `install` refuses to
 * write it.
 */
export function listTopLevelDirectories(projectDir: string): readonly string[] {
  try {
    return readdirSync(projectDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
