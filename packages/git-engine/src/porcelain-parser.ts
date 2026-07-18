/**
 * Porcelain-v2 parser + dirty-snapshot capture — roadmap/07-git-control-
 * repo-worktrees.md work item 4. Implements the `git status --porcelain=v2`
 * wire format (without `-z`) per git's own documentation:
 *
 *   # <header line>                                              (skipped)
 *   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>                 (ordinary)
 *   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path>\t<origPath>  (rename/copy)
 *   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>       (unmerged)
 *   ? <path>                                                     (untracked)
 *   ! <path>                                                     (ignored)
 *
 * `path` is always the LAST field, so every line type is parsed by
 * consuming a fixed number of space-separated fields from the front and
 * treating everything after the final consumed space as the path (or, for
 * rename/copy, `path\torigPath`) — the only way a path containing a literal
 * space parses correctly without full C-style-quote-aware decoding.
 */

export interface OrdinaryEntry {
  readonly kind: "modified" | "added" | "deleted" | "typechange";
  readonly path: string;
  readonly indexStatus: string;
  readonly worktreeStatus: string;
}

export interface RenamedOrCopiedEntry {
  readonly kind: "renamed" | "copied";
  readonly path: string;
  readonly origPath: string;
  readonly score: number;
  readonly indexStatus: string;
  readonly worktreeStatus: string;
}

export interface UntrackedEntry {
  readonly path: string;
}

export interface IgnoredEntry {
  readonly path: string;
}

export interface ConflictedEntry {
  readonly path: string;
  readonly description: string;
}

export interface PorcelainV2Snapshot {
  readonly modified: readonly OrdinaryEntry[];
  readonly added: readonly OrdinaryEntry[];
  readonly deleted: readonly OrdinaryEntry[];
  readonly typechange: readonly OrdinaryEntry[];
  readonly renamed: readonly RenamedOrCopiedEntry[];
  readonly copied: readonly RenamedOrCopiedEntry[];
  readonly untracked: readonly UntrackedEntry[];
  readonly ignored: readonly IgnoredEntry[];
  readonly conflicted: readonly ConflictedEntry[];
}

interface MutableSnapshot {
  modified: OrdinaryEntry[];
  added: OrdinaryEntry[];
  deleted: OrdinaryEntry[];
  typechange: OrdinaryEntry[];
  renamed: RenamedOrCopiedEntry[];
  copied: RenamedOrCopiedEntry[];
  untracked: UntrackedEntry[];
  ignored: IgnoredEntry[];
  conflicted: ConflictedEntry[];
}

function emptyMutableSnapshot(): MutableSnapshot {
  return {
    modified: [],
    added: [],
    deleted: [],
    typechange: [],
    renamed: [],
    copied: [],
    untracked: [],
    ignored: [],
    conflicted: [],
  };
}

/** Splits `line` into exactly `fixedCount` space-separated leading fields, plus everything after the last consumed space as `rest`. Throws on a line too short to carry that many fields. */
function splitFixedFields(line: string, fixedCount: number): { fields: string[]; rest: string } {
  const fields: string[] = [];
  let cursor = 0;
  for (let i = 0; i < fixedCount; i++) {
    const spaceIdx = line.indexOf(" ", cursor);
    if (spaceIdx === -1) {
      throw new Error(
        `porcelain-v2: malformed line — expected ${fixedCount} leading fields: "${line}"`,
      );
    }
    fields.push(line.slice(cursor, spaceIdx));
    cursor = spaceIdx + 1;
  }
  return { fields, rest: line.slice(cursor) };
}

function classifyOrdinary(x: string, y: string): OrdinaryEntry["kind"] {
  if (x === "D" || y === "D") return "deleted";
  if (x === "A" || y === "A") return "added";
  if (x === "T" || y === "T") return "typechange";
  return "modified";
}

const UNMERGED_DESCRIPTIONS: Readonly<Record<string, string>> = {
  DD: "both deleted",
  AU: "added by us",
  UD: "deleted by them",
  UA: "added by them",
  DU: "deleted by us",
  AA: "both added",
  UU: "both modified",
};

function parseLine(line: string, out: MutableSnapshot): void {
  if (line.length === 0 || line.startsWith("#")) return;

  const marker = line[0];
  if (marker === "1") {
    // "1" <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>  — 8 fixed fields incl. leading "1".
    const { fields, rest } = splitFixedFields(line, 8);
    const xy = fields[1]!;
    const entry: OrdinaryEntry = {
      kind: classifyOrdinary(xy[0]!, xy[1]!),
      path: rest,
      indexStatus: xy[0]!,
      worktreeStatus: xy[1]!,
    };
    out[entry.kind].push(entry);
    return;
  }

  if (marker === "2") {
    // "2" <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path>\t<origPath> — 9 fixed fields.
    const { fields, rest } = splitFixedFields(line, 9);
    const xy = fields[1]!;
    const xScore = fields[8]!;
    const tabIdx = rest.indexOf("\t");
    if (tabIdx === -1) {
      throw new Error(`porcelain-v2: rename/copy line missing tab-separated origPath: "${line}"`);
    }
    const path = rest.slice(0, tabIdx);
    const origPath = rest.slice(tabIdx + 1);
    const kind: "renamed" | "copied" = xScore.startsWith("C") ? "copied" : "renamed";
    const score = Number.parseInt(xScore.slice(1), 10);
    const entry: RenamedOrCopiedEntry = {
      kind,
      path,
      origPath,
      score,
      indexStatus: xy[0]!,
      worktreeStatus: xy[1]!,
    };
    out[kind].push(entry);
    return;
  }

  if (marker === "u") {
    // "u" <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path> — 10 fixed fields.
    const { fields, rest } = splitFixedFields(line, 10);
    const xy = fields[1]!;
    out.conflicted.push({
      path: rest,
      description: UNMERGED_DESCRIPTIONS[xy] ?? `unmerged (${xy})`,
    });
    return;
  }

  if (marker === "?") {
    const { rest } = splitFixedFields(line, 1);
    out.untracked.push({ path: rest });
    return;
  }

  if (marker === "!") {
    const { rest } = splitFixedFields(line, 1);
    out.ignored.push({ path: rest });
    return;
  }

  throw new Error(`porcelain-v2: unrecognized line marker "${marker}" in line: "${line}"`);
}

/** Parses a `git status --porcelain=v2` byte stream (no `-z`) into a structured snapshot. Pure function: no I/O, no shared mutable state across calls. */
export function parsePorcelainV2(text: string): PorcelainV2Snapshot {
  const out = emptyMutableSnapshot();
  const lines = text.split("\n");
  for (const line of lines) {
    parseLine(line, out);
  }
  return out;
}

/** Every changed-path string across all "dirty" categories (everything except `ignored`); a rename/copy contributes BOTH `path` and `origPath`. Feeds WI5's planned-write-vs-dirty-path overlap check. */
export function dirtyPaths(snapshot: PorcelainV2Snapshot): readonly string[] {
  const paths: string[] = [];
  for (const e of snapshot.modified) paths.push(e.path);
  for (const e of snapshot.added) paths.push(e.path);
  for (const e of snapshot.deleted) paths.push(e.path);
  for (const e of snapshot.typechange) paths.push(e.path);
  for (const e of snapshot.renamed) {
    paths.push(e.path, e.origPath);
  }
  for (const e of snapshot.copied) {
    paths.push(e.path, e.origPath);
  }
  for (const e of snapshot.untracked) paths.push(e.path);
  for (const e of snapshot.conflicted) paths.push(e.path);
  return paths;
}
