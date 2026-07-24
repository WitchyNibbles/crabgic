/**
 * Deterministic content digest over this plugin's packaged, distributable
 * files — roadmap/10-plugin-and-installer.md §In scope, "Distribution":
 * "a CapabilityManifest entry for the plugin itself, digest-pinned" and
 * "a vendored `--plugin-dir` install resolves to the identical digest as
 * the marketplace listing." Deliberately independent of git (a working
 * directory need not be a git repo at all for `--plugin-dir` vendoring to
 * work) — the digest is a pure function of file contents, computed
 * identically whether the source is a marketplace checkout or a vendored
 * directory copy.
 *
 * Line-ending normalization matches this phase's own checksum-stability
 * requirement for the installer's drift detector (§Test plan, Unit:
 * "checksum/drift hash stability across line-ending normalization").
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Directories/files under a plugin root that are never part of the packaged, distributable artifact. */
const EXCLUDED_ENTRIES: ReadonlySet<string> = new Set([
  "src",
  "dist",
  "node_modules",
  "package.json",
  "tsconfig.json",
  ".claude-plugin", // contains marketplace.json, which cites this digest — excluded to avoid self-reference.
]);

function normalizeForDigest(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

/** Recursively collects every packaged file's path (relative to `pluginRoot`, POSIX-separated, sorted) under `pluginRoot`, skipping `EXCLUDED_ENTRIES`. */
export function listPackagedFiles(pluginRoot: string): readonly string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = join(dir, entry.name);
      const relPath = relative(pluginRoot, entryPath);
      const topLevel = relPath.split(sep)[0]!;
      if (EXCLUDED_ENTRIES.has(topLevel)) continue;
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile()) {
        files.push(relPath.split(sep).join("/"));
      }
    }
  }
  if (statSync(pluginRoot).isDirectory()) walk(pluginRoot);
  return files.sort();
}

/**
 * Computes a stable sha256 hex digest over every packaged file's relative
 * path + normalized content. Two directories with byte-identical packaged
 * content (modulo CRLF/LF) always produce the same digest, regardless of
 * filesystem iteration order (file list is sorted) or absolute path.
 */
export function computeContentDigest(pluginRoot: string): string {
  const hash = createHash("sha256");
  for (const relPath of listPackagedFiles(pluginRoot)) {
    const content = readFileSync(join(pluginRoot, ...relPath.split("/")), "utf8");
    hash.update(relPath);
    hash.update("\0");
    hash.update(normalizeForDigest(content));
    hash.update("\0");
  }
  return hash.digest("hex");
}
