/**
 * Worktree ref + on-disk path boundary — roadmap/07-git-control-repo-
 * worktrees.md work item 6: "neutral internal ref `work/<run>/<change-
 * set>/<task>/<attempt>`" and the Security test-plan bullet: "path-escape
 * fixtures (`../`, absolute paths, symlink escape out of the assigned
 * worktree) rejected at the worktree boundary."
 */

import { existsSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

export interface WorktreeRefParts {
  readonly runId: string;
  readonly changeSetId: string;
  readonly taskId: string;
  readonly attempt: string;
}

export class InvalidRefSegmentError extends Error {
  constructor(field: string, value: string) {
    super(`worktree-ref: invalid ref segment for "${field}": "${value}"`);
    this.name = "InvalidRefSegmentError";
  }
}

// Git ref path-segment rules (simplified, per git-check-ref-format(1)): no
// slash, no control chars, no space/tilde/caret/colon/question/asterisk/
// bracket/backslash, no leading/trailing dot, no ".." anywhere, no
// trailing ".lock", not the single character "@".
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

function assertValidSegment(field: string, value: string): void {
  if (
    value.length === 0 ||
    !SEGMENT_PATTERN.test(value) ||
    value.startsWith(".") ||
    value.endsWith(".") ||
    value.includes("..") ||
    value.endsWith(".lock")
  ) {
    throw new InvalidRefSegmentError(field, value);
  }
}

/** Builds the neutral internal worktree ref `work/<run>/<change-set>/<task>/<attempt>`. Throws `InvalidRefSegmentError` if any part isn't a safe single ref-path segment. */
export function buildWorktreeRef(parts: WorktreeRefParts): string {
  assertValidSegment("runId", parts.runId);
  assertValidSegment("changeSetId", parts.changeSetId);
  assertValidSegment("taskId", parts.taskId);
  assertValidSegment("attempt", parts.attempt);
  return `work/${parts.runId}/${parts.changeSetId}/${parts.taskId}/${parts.attempt}`;
}

export class WorktreePathEscapeError extends Error {
  constructor(rootDir: string, segments: readonly string[]) {
    super(
      `worktree-ref: path escape rejected — segments ${JSON.stringify(segments)} under root "${rootDir}"`,
    );
    this.name = "WorktreePathEscapeError";
  }
}

/**
 * Joins `segments` under `rootDir`, rejecting `../`, absolute-path
 * segments, and a symlink escape out of the supervisor-owned root.
 *
 * The symlink check walks the JOINED segments one at a time (not
 * `rootDir`'s own ancestor chain, which may legitimately not exist yet on
 * a first-ever call): for every prefix of the candidate path that already
 * exists on disk, its realpath must stay within `realRoot`. A prefix that
 * doesn't exist yet is skipped — nothing could have been symlink-planted
 * there — which is what makes this safe to call before `rootDir` itself
 * has ever been created (the ordinary first-use case) while still catching
 * an attacker- or bug-planted symlink at any EXISTING intermediate
 * segment. Each element of `segments` must be a single path component (no
 * embedded `/`).
 */
export function resolveWorktreePath(rootDir: string, segments: readonly string[]): string {
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment === "." ||
      segment === ".."
    ) {
      throw new WorktreePathEscapeError(rootDir, segments);
    }
  }

  const realRoot = existsSync(rootDir) ? realpathSync(rootDir) : resolve(rootDir);

  let currentLexical = realRoot;
  for (const segment of segments) {
    currentLexical = resolve(currentLexical, segment);
    if (existsSync(currentLexical)) {
      const real = realpathSync(currentLexical);
      if (real !== realRoot && !real.startsWith(realRoot + sep)) {
        throw new WorktreePathEscapeError(rootDir, segments);
      }
    }
  }

  return currentLexical;
}
