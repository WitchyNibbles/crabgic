/**
 * Unified-diff → the set of lines a change set ADDED, per file. Owner ruling R6
 * (2026-08-16), and the first of the three ingredients
 * `docs/evidence/phase-14/README.md` names as missing for changed-line coverage:
 * "a diff/changed-line-set input".
 *
 * WHY A REAL PARSER AND NOT `security/root-cause-detector.ts`'s helper. That
 * helper is `diffText.split("\n").filter(line => line.startsWith("+"))` — it
 * answers "does any added line look like this", which needs no line numbers and
 * no file paths. Coverage asks "was THIS line of THAT file executed", so hunk
 * headers have to be read and a cursor carried. The evidence doc called that
 * helper "a reusable starting point"; it is a starting point and not the answer.
 *
 * ONLY ADDED LINES, deliberately. A line the diff did not touch is not this
 * change set's obligation — that is the whole content of "bound coverage to the
 * change, not to the repository". Removed lines have no coverage to measure, and
 * context lines belong to whoever wrote them.
 *
 * WHAT IT REFUSES TO GUESS. Anything it cannot read confidently produces NO
 * changed lines for that file rather than a guess, and the gate treats an
 * unreadable diff as a refusal rather than as an empty obligation — see
 * `./changed-line-coverage.ts`. A parser that silently under-reports the changed
 * set would quietly shrink the denominator of the very check it feeds, which is
 * the failure this whole ruling is about.
 */

/** Path → the 1-based line numbers this diff added to it. */
export type ChangedLines = ReadonlyMap<string, ReadonlySet<number>>;

/**
 * `@@ -oldStart,oldCount +newStart,newCount @@`, with either count optional
 * (git omits `,1`). Anchored, so a `@@` appearing inside added CONTENT — a
 * literal in a test fixture, say — cannot be mistaken for a hunk header,
 * because a content line always carries its `+`/`-`/space prefix first.
 */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Strips git's `a/`/`b/` prefix and any trailing tab-delimited timestamp the
 * unified-diff format permits (`+++ file\t2026-01-01 00:00:00`).
 *
 * A `"quoted"` path — what git emits when a name carries a special character —
 * is returned UNRESOLVED and its file is skipped by the caller. Dequoting C-style
 * escapes correctly is more surface than this needs, and a path decoded WRONG
 * would attribute one file's changed lines to another. Skipping is visible in the
 * gate's own output; a mis-decode would not be.
 */
function parseNewPath(headerLine: string): string | undefined {
  const raw = headerLine.slice(4).split("\t")[0]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  if (raw === "/dev/null") return undefined; // the file was deleted
  if (raw.startsWith('"')) return undefined; // see this function's doc comment
  return raw.startsWith("b/") ? raw.slice(2) : raw;
}

/**
 * Parses a unified diff (`git diff`, `git diff --cached`, `git format-patch`
 * body) into the added-line set per file.
 *
 * Tolerant of a truncated or malformed tail: everything read before the damage
 * is kept, because a partial changed set is still a real obligation. It is NOT
 * tolerant in the direction that matters — nothing here ever invents a line
 * number, and a hunk whose header it cannot read contributes nothing rather
 * than being attributed to the previous hunk's cursor.
 */
export function parseChangedLines(diffText: string): ChangedLines {
  const byPath = new Map<string, Set<number>>();
  let currentPath: string | undefined;
  let cursor: number | undefined;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ") || line.startsWith("--- ")) {
      // A new file's header begins. Drop the cursor so a stray content line
      // between headers cannot be attributed to the file that just ended.
      cursor = undefined;
      if (line.startsWith("diff --git ")) currentPath = undefined;
      continue;
    }
    if (line.startsWith("+++ ")) {
      currentPath = parseNewPath(line);
      cursor = undefined;
      continue;
    }
    if (line.startsWith("@@")) {
      const match = HUNK_HEADER.exec(line);
      // A `@@@` combined diff (merge commit) does not match, so its content is
      // skipped entirely rather than misread against a stale cursor.
      cursor = match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
      continue;
    }
    if (currentPath === undefined || cursor === undefined) continue;

    if (line.startsWith("+")) {
      let lines = byPath.get(currentPath);
      if (lines === undefined) {
        lines = new Set<number>();
        byPath.set(currentPath, lines);
      }
      lines.add(cursor);
      cursor += 1;
      continue;
    }
    if (line.startsWith("-")) continue; // removed: no new-side line consumed
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (line.startsWith(" ") || line.length === 0) {
      // Context. An EMPTY string is context too: git writes an unprefixed empty
      // line for a blank context line, and treating it as a section break would
      // silently desynchronize the cursor for the rest of the hunk.
      cursor += 1;
      continue;
    }
    // Anything else ends the hunk (the next file's `index`/`similarity` header,
    // a binary-file notice, trailing prose). Stop trusting the cursor.
    cursor = undefined;
  }

  return byPath;
}

/** Total added lines across every file — the denominator before instrumentability is considered. */
export function changedLineCount(changed: ChangedLines): number {
  let total = 0;
  for (const lines of changed.values()) total += lines.size;
  return total;
}
