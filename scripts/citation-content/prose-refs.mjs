/**
 * The prose lane: `path:NN` references written in `roadmap/*.md` and in the
 * defect records.
 *
 * The structured records are validated three ways; the PROSE around them is
 * validated by nothing at all, and it carries 816 `path:line` references — the
 * roadmap's own criterion annotations, every defect record's measurement. A
 * reader follows those exactly as they follow a record's `ref`.
 *
 * This lane is deliberately narrow. Content heuristics over prose are too
 * imprecise to gate on (they classify a fifth of the corpus as "maybe moved"),
 * so the blocking check is only what cannot be argued with: **the file exists
 * and the line is inside it.** That is measured at zero failures today, which is
 * the point — a lane that starts at zero failures is one nobody has to mute, and
 * it fails the first time a PR deletes a file the roadmap points at or cites a
 * line past a file's end.
 *
 * Deciding WHICH unresolvable reference is a defect took two corrections, in
 * opposite directions, and the rule is the narrow band between them.
 *
 * A first cut treated "contains a slash" as "is repo-relative" and reported 38
 * blocking failures on package-relative fragments (`store/append-entry.ts:145`,
 * written relative to `packages/journal/src/`) — and a lane that starts with 38
 * false failures is a lane that gets deleted. So resolution goes through the
 * same unique-suffix resolver the structured lane uses.
 *
 * The over-correction then made EVERY unresolvable path a mere note, which made
 * the lane toothless in exactly the case it was built for: deleting
 * `packages/supervisor/src/router/build-router.ts`, cited twice in a defect
 * record, left the check GREEN — the two references silently degraded from
 * "resolved" to "bare basename (unchecked)", a counter nothing gates on. A check
 * that goes quiet when the thing it watches for happens is worse than no check.
 *
 * The rule: a reference whose FIRST PATH SEGMENT is a real top-level directory
 * of this repository is claiming a repo-rooted path. If that path resolves to
 * nothing, the file is gone and that is a `missing` — blocking. Everything else
 * (a bare basename, a package-relative fragment) names no root, cannot be
 * resolved without guessing, and stays a reported `unresolved`. Failing on an
 * ambiguous basename means failing on a guess; staying silent on a deleted
 * `packages/...` path means not checking at all.
 */
import path from "node:path";

const FENCE = /^\s{0,3}(?:`{3,}|~{3,})/;
const REF =
  /([A-Za-z0-9_@./-]+\.(?:ts|tsx|mjs|cjs|js|json|md|txt|snap|sh|yml|yaml)):(\d+)(?:-(\d+))?/g;
/** `foo.ts:12, :34` and `foo.ts:12/:34` — a continuation of the same reference. */
const CONTINUATION = /^\s*[,/]\s*:(\d+)(?:-(\d+))?/;

/** Lines outside fenced code blocks, 1-based. Fenced refs are examples, not claims. */
export function linesOutsideFences(text) {
  const kept = [];
  let inFence = false;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) kept.push({ lineNumber: i + 1, text: lines[i] });
  }
  return kept;
}

/**
 * Every `path:NN` (and its `, :MM` continuations) on one line, with the spans it
 * claims.
 */
export function extractRefs(line) {
  const refs = [];
  for (const match of line.matchAll(REF)) {
    const low = Number(match[2]);
    const high = match[3] === undefined ? low : Number(match[3]);
    const spans = [[low, high]];
    let rest = line.slice(match.index + match[0].length);
    for (;;) {
      const continuation = CONTINUATION.exec(rest);
      if (continuation === null) break;
      const continuationLow = Number(continuation[1]);
      spans.push([
        continuationLow,
        continuation[2] === undefined ? continuationLow : Number(continuation[2]),
      ]);
      rest = rest.slice(continuation[0].length);
    }
    refs.push({ filePath: match[1], spans });
  }
  return refs;
}

/**
 * Is this reference claiming a path from the repository root? True when its
 * first segment is a real top-level directory of the tree being checked, which
 * is what separates `packages/supervisor/src/x.ts` (a repo-rooted claim, and a
 * defect if it does not exist) from `store/append-entry.ts` (a fragment written
 * relative to somewhere else, unresolvable without guessing).
 */
export function isRepoRootedPath(filePath, topLevelDirectories) {
  const [firstSegment, ...rest] = filePath.split("/");
  return rest.length > 0 && topLevelDirectories.has(firstSegment);
}

/**
 * Checks one source file's prose references.
 * `tier` is `"ok"`, `"past-eof"` / `"missing"` (blocking) or `"unresolved"`
 * (reported).
 */
export function checkProseFile(
  sourceRelativePath,
  text,
  load,
  resolvePath,
  topLevelDirectories = new Set(),
) {
  const rows = [];
  const sourceDirectory = path.posix.dirname(sourceRelativePath);
  for (const { lineNumber, text: line } of linesOutsideFences(text)) {
    for (const { filePath, spans } of extractRefs(line)) {
      const resolved = resolvePath(filePath, sourceDirectory);
      const target = resolved === null ? null : load(resolved);
      for (const [low, high] of spans) {
        const row = {
          source: `${sourceRelativePath}:${String(lineNumber)}`,
          ref: `${filePath}:${String(low)}${high === low ? "" : `-${String(high)}`}`,
          resolved,
          tier: "ok",
          note: "",
        };
        if (target === null) {
          const repoRooted = isRepoRootedPath(filePath, topLevelDirectories);
          row.tier = repoRooted ? "missing" : "unresolved";
          row.note = repoRooted
            ? "names a repo-rooted path that does not exist — the file was moved or deleted"
            : "names no single file in the repository — not checked";
        } else if (high > target.lineCount) {
          row.tier = "past-eof";
          row.note = `${path.posix.basename(filePath)} has ${String(target.lineCount)} lines`;
        }
        rows.push(row);
      }
    }
  }
  return rows;
}
