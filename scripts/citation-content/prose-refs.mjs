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
 * A reference that names no unique file is counted and listed, never failed.
 * Two shapes produce those, and BOTH had to be measured rather than assumed:
 * bare basenames (`registry.ts:209`), and package-relative fragments
 * (`store/append-entry.ts:145`, written relative to `packages/journal/src/`).
 * A first cut of this lane treated "contains a slash" as "is repo-relative" and
 * reported 38 blocking failures on the second shape alone — a lane that starts
 * with 38 false failures is a lane that gets deleted. Resolution therefore goes
 * through the same unique-suffix resolver the structured lane uses, and anything
 * still ambiguous is reported, not failed: failing on an ambiguous basename
 * means failing on a guess.
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
 * Checks one source file's prose references.
 * `tier` is `"ok"`, `"past-eof"` (blocking) or `"unresolved"` (reported).
 */
export function checkProseFile(sourceRelativePath, text, load, resolvePath) {
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
          row.tier = "unresolved";
          row.note = "names no single file in the repository — not checked";
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
