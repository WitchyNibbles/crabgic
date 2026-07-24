/**
 * `walkRepoTree` — the sole file-enumeration primitive every detector
 * (`../detectors/*`) uses to see a project's files. roadmap/12-stack-
 * detection-quarantine.md §Goal: "`StackEvidence` is always derived from
 * static analysis with zero child-process spawns." This module imports
 * only `node:fs`/`node:path` — never `node:child_process` — and the
 * repo-wide `../spawn-surface-scan.test.ts` proves that statically.
 *
 * Safety properties (all validated at this boundary since detectors read
 * untrusted, potentially adversarial project files — CLAUDE.md's own
 * "validate/sandbox all parsing" instruction):
 *  - Common VCS/dependency/build-output noise directories are skipped
 *    (`.git`, `node_modules`, `dist`, `build`, `.venv`, `__pycache__`,
 *    `target`, `vendor`) — both for signal quality and so a huge
 *    `node_modules` tree never blows the entry budget below.
 *  - A symlink is never followed if it resolves outside the walked root
 *    (`realpathSync` compared against the root's own realpath) — a
 *    malicious project could otherwise use a symlink to read/leak
 *    arbitrary host files through a detector's "safe" text read.
 *  - A directory is never re-entered while its own realpath is already on
 *    the CURRENT ancestor path (adversarial-review fix, HIGH/confirmed
 *    DoS: a directory of `k` self-referential symlinks — `loopN -> .` —
 *    with zero regular files used to recurse with branching factor `k`
 *    down to `maxDepth`, since `maxEntries` was only ever decremented when
 *    a FILE was pushed, never on a directory visit; k=2 took ~970ms, k=3
 *    did not finish in 90s). Every directory visit (symlinked OR plain)
 *    now carries a per-branch `Set` of ancestor realpaths; re-entering one
 *    already in that set is refused, turning the traversal into a true
 *    tree walk regardless of how symlinks alias real directories.
 *  - Traversal is ALSO bounded by a directory-visit budget (reusing
 *    `maxEntries`, defense-in-depth alongside the ancestor-cycle guard
 *    above) in addition to `maxDepth` and the file-count budget, so a
 *    pathological or adversarial tree (deeply nested, or absurdly wide)
 *    cannot exhaust memory/time — the walk stops early rather than
 *    growing unbounded.
 *  - A missing root returns `[]` rather than throwing — detectors run
 *    against a best-effort snapshot of whatever exists, never crash the
 *    whole evidence pass over one missing/unreadable path.
 */
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface WalkedFile {
  readonly relativePath: string;
  readonly absolutePath: string;
}

export interface WalkOptions {
  readonly maxDepth?: number;
  readonly maxEntries?: number;
  readonly ignoreDirNames?: readonly string[];
}

const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_MAX_ENTRIES = 20_000;
const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  "vendor",
  ".cache",
]);

function resolveRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function isWithinRoot(rootRealpath: string, candidateRealpath: string): boolean {
  if (candidateRealpath === rootRealpath) return true;
  return candidateRealpath.startsWith(`${rootRealpath}/`);
}

/**
 * Enumerates every plain file under `rootDir`, depth/entry-bounded, never
 * following a symlink that escapes `rootDir`. Returns `[]` (never throws)
 * when `rootDir` does not exist or is not a directory.
 */
export function walkRepoTree(rootDir: string, options: WalkOptions = {}): WalkedFile[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const ignored = new Set(options.ignoreDirNames ?? DEFAULT_IGNORED_DIRS);

  if (!existsSync(rootDir)) return [];
  const rootRealpath = resolveRealpath(rootDir);
  if (rootRealpath === undefined) return [];
  const rootStat = statSync(rootDir, { throwIfNoEntry: false });
  if (rootStat === undefined || !rootStat.isDirectory()) return [];

  const out: WalkedFile[] = [];
  let dirVisits = 0;

  function visit(
    dir: string,
    depth: number,
    rootRp: string,
    ancestorRealpaths: ReadonlySet<string>,
  ): void {
    if (out.length >= maxEntries) return;
    if (depth > maxDepth) return;
    if (dirVisits >= maxEntries) return; // directory-visit budget — defense-in-depth alongside the ancestor-cycle guard below
    dirVisits += 1;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (out.length >= maxEntries) return;
      if (dirVisits >= maxEntries) return;
      const fullPath = join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        const targetRealpath: string | undefined = resolveRealpath(fullPath);
        if (targetRealpath === undefined) continue; // dangling symlink
        if (!isWithinRoot(rootRp, targetRealpath)) {
          continue; // escapes the walked root — never followed
        }
        const targetStat = statSync(fullPath, { throwIfNoEntry: false });
        if (targetStat === undefined) continue;
        if (targetStat.isDirectory()) {
          if (ignored.has(entry.name)) continue;
          if (ancestorRealpaths.has(targetRealpath)) continue; // refuse to re-enter a realpath already on the current ancestor path
          visit(fullPath, depth + 1, rootRp, new Set([...ancestorRealpaths, targetRealpath]));
        } else if (targetStat.isFile()) {
          out.push({ relativePath: relative(rootDir, fullPath), absolutePath: fullPath });
        }
        continue;
      }

      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) continue;
        const childRealpath = resolveRealpath(fullPath);
        if (childRealpath !== undefined && ancestorRealpaths.has(childRealpath)) continue;
        const nextAncestors =
          childRealpath === undefined
            ? ancestorRealpaths
            : new Set([...ancestorRealpaths, childRealpath]);
        visit(fullPath, depth + 1, rootRp, nextAncestors);
      } else if (entry.isFile()) {
        out.push({ relativePath: relative(rootDir, fullPath), absolutePath: fullPath });
      }
    }
  }

  visit(rootDir, 0, rootRealpath, new Set([rootRealpath]));
  return out;
}
