/**
 * The normalization ladder, and the line index each rung searches.
 *
 * A citation in `docs/evidence/criteria-closeout/phase-NN.json` quotes source
 * text inside prose. The quote is written by a human reading the file, so it is
 * almost never a byte-for-byte copy of one line: it joins a wrapped statement
 * onto one line, it drops the trailing comma prettier inserted when it rewrapped
 * a call, it un-bolds a markdown sentence, it un-comments a wrapped YAML comment.
 * Every one of those is a real, measured convention in the merged corpus, not a
 * hypothetical (see `docs/evidence/citation-resolver/` for the census).
 *
 * A resolver that only byte-compares therefore reports hundreds of phantom
 * problems, gets muted, and protects nothing — which is worse than no resolver,
 * because the muting is silent. So matching is attempted at four rungs, in
 * order, and the rung that matched is RECORDED rather than hidden: level 1 is
 * "the quote is the file's text modulo whitespace", level 4 is "the quote is a
 * de-marked-up rendering of the file's text". A citation that only matches at
 * level 4 is still a true citation, but a reader should know that is what they
 * are being handed.
 *
 * Anchoring is by OCCURRENCE OVERLAP, never by a tolerance window: the
 * [startLine, endLine] range an occurrence spans must intersect the range the
 * `:NN` marker claims. That is what lets a quote which joins a three-line
 * statement anchor exactly at the statement's first line while still catching an
 * off-by-one marker — the failure class an independent reviewer found 16 of in a
 * single merged record (`docs/verification-playbook.md`, "YOUR RESOLVER MUST
 * LINE-ANCHOR EVERY FRAGMENT").
 *
 * Dependency-free, like every other script in this directory: `meta-checks` runs
 * `npm ci` with no build step.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Normalization rungs, weakest claim last. Recorded per fragment. */
export const LEVELS = ["collapsed", "stripped", "code", "prose"];

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

/** Collapse every whitespace run to one space and trim. */
export function collapse(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** Strip all whitespace. */
export function strip(text) {
  return text.replace(/\s+/g, "");
}

/**
 * Whitespace-stripped, minus the trailing commas prettier leaves before a
 * closing bracket when it rewraps a call across lines. A quote written from the
 * one-line form of `fn(a, b)` reads `fn(a, b)`; the rewrapped file reads
 * `fn(\n  a,\n  b,\n)`, whose stripped form is `fn(a,b,)`.
 */
export function codeNormalize(text) {
  return strip(text).replace(/,(?=[)\]}])/g, "");
}

/**
 * De-markup: drops line-comment leaders (`#`, `//`, jsdoc `*`) and markdown
 * emphasis/backtick runs, then collapses. Applied to BOTH sides, so it can only
 * make a match easier, never change which text is being compared.
 */
export function proseNormalize(text) {
  return collapse(
    text
      .replace(/^[ \t]*(?:#+|\/\/+|\*(?!\*))[ \t]?/gm, "")
      .replace(/[*_`]/g, "")
      .replace(/\\'/g, "'"),
  );
}

function buildJoinedIndex(lines, transform, separator) {
  let joined = "";
  const lineIds = [];
  for (let i = 0; i < lines.length; i += 1) {
    const chunk = transform(lines[i]);
    for (let c = 0; c < chunk.length; c += 1) lineIds.push(i + 1);
    joined += chunk;
    if (separator.length > 0 && i < lines.length - 1) {
      for (let c = 0; c < separator.length; c += 1) lineIds.push(i + 1);
      joined += separator;
    }
  }
  return { joined, lineIds };
}

/**
 * The `code` rung is derived from the whole-file STRIPPED index, not built line
 * by line. That is the point of it: prettier's rewrap puts the comma at the end
 * of one line and its closing bracket at the start of the next, so the pair only
 * becomes visible once the lines are joined. Building this rung per line drops
 * nothing at all and the whole rung silently does nothing — which is exactly what
 * a first cut of this file did, and the trailing-comma trust control caught it.
 */
function deriveCodeIndex(stripped) {
  const characters = [];
  const lineIds = [];
  for (let i = 0; i < stripped.joined.length; i += 1) {
    if (stripped.joined[i] === "," && ")]}".includes(stripped.joined[i + 1] ?? "")) continue;
    characters.push(stripped.joined[i]);
    lineIds.push(stripped.lineIds[i]);
  }
  return { joined: characters.join(""), lineIds };
}

/**
 * Reads a file once and builds one search index per rung. `lineIds[i]` is the
 * 1-based source line the character at `joined[i]` came from, which is how an
 * occurrence is turned back into a [startLine, endLine] range.
 */
function buildFileIndex(absolutePath, relativePath) {
  const raw = readFileSync(absolutePath, "utf8");
  const lines = raw.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const isMarkdown = MARKDOWN_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
  const stripped = buildJoinedIndex(lines, strip, "");
  return {
    relativePath,
    lineCount: lines.length,
    lines,
    isMarkdown,
    indexes: {
      collapsed: buildJoinedIndex(lines, collapse, " "),
      stripped,
      code: deriveCodeIndex(stripped),
      prose: buildJoinedIndex(lines, proseNormalize, " "),
    },
  };
}

const NEEDLE_NORMALIZERS = {
  collapsed: collapse,
  stripped: strip,
  code: codeNormalize,
  prose: proseNormalize,
};

/** The shortest normalized needle worth searching for; below this any file matches. */
export const MIN_NEEDLE_LENGTH = 6;

/**
 * Every occurrence of `needle` in one rung's index, as 1-based inclusive
 * [startLine, endLine] pairs.
 *
 * There is deliberately NO cap on the number of occurrences collected. An
 * earlier research instrument capped the scan at 50 and produced a false MOVED
 * against a frozen report where `"exitStatus": 0` occurs more than 50 times: the
 * true occurrence was simply past the cap. A cap on an occurrence scan silently
 * converts "this text repeats" into "this text is somewhere else".
 */
export function occurrencesAtLevel(fileIndex, needle, level) {
  const normalized = NEEDLE_NORMALIZERS[level](needle);
  if (normalized.length < MIN_NEEDLE_LENGTH) return [];
  const { joined, lineIds } = fileIndex.indexes[level];
  const found = [];
  let from = 0;
  for (;;) {
    const at = joined.indexOf(normalized, from);
    if (at < 0) break;
    const end = Math.min(at + normalized.length - 1, lineIds.length - 1);
    found.push([lineIds[at], lineIds[end]]);
    from = at + 1;
  }
  return found;
}

/**
 * Walks the ladder and returns the first rung that matches, with the rung named.
 * `{ occurrences: [], level: null }` when nothing matches at any rung.
 */
export function findOccurrences(fileIndex, needle) {
  for (const level of LEVELS) {
    const found = occurrencesAtLevel(fileIndex, needle, level);
    if (found.length > 0) return { occurrences: found, level };
  }
  return { occurrences: [], level: null };
}

/** True when an occurrence's line range intersects the marker's line range. */
export function overlapsMarker(occurrences, low, high) {
  return occurrences.some(([start, end]) => start <= high && end >= low);
}

/**
 * Repo-rooted file cache. Returns `null` for a path that is absent, is not a
 * regular file, or escapes the repository root — the same containment rule
 * `check-criteria-closeout.mjs` applies to a citation's `ref`.
 */
export function createFileLoader(repoRoot) {
  const cache = new Map();
  return function load(relativePath) {
    if (cache.has(relativePath)) return cache.get(relativePath);
    let index = null;
    const absolute = path.resolve(repoRoot, relativePath);
    const contained = absolute === repoRoot || absolute.startsWith(repoRoot + path.sep);
    if (contained && existsSync(absolute) && statSync(absolute).isFile()) {
      index = buildFileIndex(absolute, relativePath);
    }
    cache.set(relativePath, index);
    return index;
  };
}
