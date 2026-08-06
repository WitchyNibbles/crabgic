/**
 * The four-rule resolver over `docs/evidence/criteria-closeout/phase-NN.json`.
 *
 * `docs/verification-playbook.md` ("THE RESOLVER DESIGN THAT ACTUALLY WORKS")
 * settles the rule set; this file is that design, with the corpus's measured
 * conventions absorbed so its silence means something:
 *
 *   1. **Content** — the quoted text exists in the cited file. The weakest rule,
 *      and the only one most resolvers implement.
 *   2. **Line anchoring** — it is on the line the `:NN` marker claims, by
 *      occurrence overlap and with no tolerance window. This is the rule that
 *      catches the whole measured failure class: a merged citation that still
 *      validates, still resolves, and points at the wrong line forever.
 *   3. **Group consecutiveness** — `:LO-HI 'a' / 'b' / 'c'` claims consecutive
 *      lines; a resolver that anchors only the first fragment passes a citation
 *      whose range head is wrong while every fragment is real.
 *   4. **Repeat-text detection** — a fragment whose text occurs more than once
 *      is content-verified but NOT position-verified. A byte-comparer passed six
 *      citations that quoted `"verdict": "PASS",` from six different items.
 *
 * **Span containment is the rule that earns its keep.** An independent audit of
 * this corpus found it was the single rule that caught every real finding —
 * both of the filed ones, all three hand-off ones, and four more the auditor
 * added. It is also the rule the merged corpus violates most often BY
 * CONVENTION: 433 fragments deliberately sit outside their citation's declared
 * `ref` span, phase-04 style, where the `ref` anchors one representative line
 * and the assertion then walks the surrounding evidence. Both facts are true at
 * once, so the rule is neither dropped nor made retroactively fatal. It is
 * PINNED: `outsideSpan` is part of every fragment's baseline pin, so the 433 are
 * seeded as known and any CHANGE — a new out-of-span fragment, or an existing
 * one moving — fails. New and edited citations are held to it outright.
 *
 * Rules 3 and 4 stay advisory: group consecutiveness fails on the same
 * comment-interleaved corpus, and repeat text is a statement about the file, not
 * a defect in the record. Per Hard Rule 5, a validator that fails a merged
 * record is a stop-and-report, not something to land — which is why nothing here
 * turns 129 ticked criteria red on the day it lands.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { findOccurrences, occurrencesAtLevel, overlapsMarker } from "./file-index.mjs";
import {
  isCodeish,
  isCrossDomainQuote,
  parseQuotedAssertion,
  splicePieces,
} from "./quoted-assertion.mjs";

/** Citation kinds that name a file in the tree, and so can be content-checked. */
export const RESOLVABLE_KINDS = new Set(["test", "artifact", "journal-export"]);

/** Fragment verdicts that mean "the pointer is wrong", i.e. real staleness. */
export const STALE_STATUSES = new Set([
  "MOVED",
  "MOVED-AMBIG",
  "ABSENT",
  "PAST-EOF",
  "FILE-MISSING",
]);

/** Verdicts that carry no claim about the tree and are never pinned. */
const SKIPPED_STATUSES = new Set(["SKIP-short", "SKIP-log", "SKIP-commentary"]);

const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "coverage", ".vitest-cache"]);
const MIN_FRAGMENT_LENGTH = 6;
const PURE_MARKER = /^[\s:\d,\-–—/]*$/;

/**
 * How far past a spliced group's declared range its pieces may be found. A
 * spliced quote skips interleaved lines by construction (`cache.test.ts:103-106`
 * quotes three assertions with comment lines between them), so the group's reach
 * is its declared range plus one line per piece.
 */
const SPLICE_REACH = 3;

function buildBasenameIndex(repoRoot) {
  const byBasename = new Map();
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) walk(path.join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(repoRoot, path.join(directory, entry.name));
      const existing = byBasename.get(entry.name);
      if (existing === undefined) byBasename.set(entry.name, [relative]);
      else existing.push(relative);
    }
  };
  walk(repoRoot);
  return byBasename;
}

/**
 * A `quotedAssertion` may name a file by a path relative to the cited file's own
 * directory, or by bare basename. Resolves to a repo-relative path when — and
 * only when — the answer is unambiguous; an ambiguous basename resolves to
 * nothing rather than to a guess.
 */
export function createPathResolver(repoRoot, load) {
  let basenames = null;
  const cache = new Map();
  return function resolvePath(candidate, referenceDirectory) {
    const key = `${candidate}\u0000${referenceDirectory}`;
    if (cache.has(key)) return cache.get(key);
    let answer = null;
    if (load(candidate) !== null) {
      answer = candidate;
    } else {
      const sibling = path.posix.normalize(path.posix.join(referenceDirectory, candidate));
      if (load(sibling) !== null) {
        answer = sibling;
      } else {
        basenames ??= buildBasenameIndex(repoRoot);
        const hits = (basenames.get(path.posix.basename(candidate)) ?? []).filter(
          (hit) => hit === candidate || hit.endsWith(`/${candidate}`) || !candidate.includes("/"),
        );
        if (hits.length === 1) answer = hits[0];
      }
    }
    cache.set(key, answer);
    return answer;
  };
}

function classifyOccurrences(occurrences, low, high) {
  if (occurrences.length === 0) return null;
  if (overlapsMarker(occurrences, low, high)) return "OK";
  return occurrences.length === 1 ? "MOVED" : "MOVED-AMBIG";
}

function resolveSingle(fileIndex, text, low, high) {
  const { occurrences, level } = findOccurrences(fileIndex, text);
  if (occurrences.length === 0) {
    return {
      status: low !== null && low > fileIndex.lineCount ? "PAST-EOF" : "ABSENT",
      level: null,
      occurrences,
    };
  }
  const repeat = occurrences.length > 1;
  if (low === null) return { status: "OK-file", level, occurrences, repeat };
  return { status: classifyOccurrences(occurrences, low, high), level, occurrences, repeat };
}

/**
 * Resolves one quoted fragment. `spanLow`/`spanHigh` are the citation's declared
 * `ref` range, used only when the fragment carries no marker of its own.
 */
export function resolveFragment(fragment, load, resolvePath, referenceDirectory, span) {
  const text = fragment.text;
  if (isCrossDomainQuote(text)) {
    return { status: "SKIP-log", note: "quotes a CI job-log line, not a file in the tree" };
  }
  if (text.replace(/\s+/g, " ").trim().length < MIN_FRAGMENT_LENGTH || PURE_MARKER.test(text)) {
    return { status: "SKIP-short" };
  }
  const relativePath = resolvePath(fragment.filePath, referenceDirectory);
  if (relativePath === null) {
    return { status: "FILE-MISSING", filePath: fragment.filePath };
  }
  const fileIndex = load(relativePath);
  const low = fragment.low ?? span.low;
  const high = fragment.high ?? span.high ?? low;

  const direct = resolveSingle(fileIndex, text, low, high);
  if (!STALE_STATUSES.has(direct.status)) {
    return { ...direct, filePath: relativePath, low, high };
  }

  const pieces = splicePieces(text).filter(
    (piece) =>
      piece.replace(/\s+/g, " ").trim().length >= MIN_FRAGMENT_LENGTH && !PURE_MARKER.test(piece),
  );
  if (pieces.length > 1) {
    const reach = low === null ? null : high + pieces.length + SPLICE_REACH;
    const results = pieces.map((piece) => resolveSingle(fileIndex, piece, low, reach ?? null));
    if (results.every((result) => !STALE_STATUSES.has(result.status))) {
      return {
        status: "OK-pieces",
        level: results.reduce(
          (worst, result) => (LEVEL_RANK[result.level] > LEVEL_RANK[worst] ? result.level : worst),
          "collapsed",
        ),
        occurrences: results.flatMap((result) => result.occurrences),
        repeat: results.some((result) => result.repeat === true),
        filePath: relativePath,
        low,
        high,
      };
    }
    const worst =
      results.find((result) => result.status === "ABSENT" || result.status === "PAST-EOF") ??
      results.find((result) => STALE_STATUSES.has(result.status));
    return { ...worst, filePath: relativePath, low, high, spliced: true };
  }

  if (direct.status === "ABSENT" && !isCodeish(text)) {
    return {
      status: "SKIP-commentary",
      filePath: relativePath,
      note: "no code-ish characters — record commentary, not a file quote",
    };
  }
  return { ...direct, filePath: relativePath, low, high };
}

const LEVEL_RANK = { collapsed: 0, stripped: 1, code: 2, prose: 3, null: -1 };

function parseRef(ref) {
  const match = /:(\d+)(?:-(\d+))?$/.exec(ref);
  if (match === null) return { relativePath: ref, low: null, high: null };
  return {
    relativePath: ref.slice(0, match.index),
    low: Number(match[1]),
    high: match[2] === undefined ? Number(match[1]) : Number(match[2]),
  };
}

/**
 * Rule 3. For a group of fragments sharing one marker range, are the anchored
 * fragments on consecutive (non-decreasing, gap-free beyond the splice reach)
 * lines? Advisory: the corpus interleaves comments inside quoted groups.
 */
function groupConsecutivenessNotes(fragments) {
  const notes = [];
  const groups = new Map();
  for (const fragment of fragments) {
    if (fragment.resolution.low === null || fragment.resolution.status?.startsWith("OK") !== true)
      continue;
    const key = `${fragment.resolution.filePath}:${fragment.resolution.low}-${fragment.resolution.high}`;
    const anchor = fragment.resolution.occurrences?.[0]?.[0];
    if (anchor === undefined) continue;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [anchor]);
    else bucket.push(anchor);
  }
  for (const [key, anchors] of groups) {
    if (anchors.length < 2) continue;
    const sorted = [...anchors].sort((a, b) => a - b);
    const span = sorted[sorted.length - 1] - sorted[0];
    if (span > anchors.length + SPLICE_REACH) {
      notes.push(
        `group ${key}: ${anchors.length} fragments spread over ${span + 1} lines (${sorted.join(", ")})`,
      );
    }
  }
  return notes;
}

/** Stable per-citation key. Survives citation reordering; changes when the ref changes. */
export function citationKey(recordName, criterionIndex, ref, ordinal) {
  const suffix = ordinal > 0 ? `#${String(ordinal + 1)}` : "";
  return `${recordName}#c${String(criterionIndex)}#${ref}${suffix}`;
}

/**
 * The occurrence a fragment is actually anchored at: the one that overlaps its
 * marker if any does, otherwise the first. This — not the marker — is what span
 * containment must be measured against, because the whole point is to catch a
 * fragment whose real text sits outside the range the citation declares,
 * however it got there.
 */
export function anchorOccurrence(resolution) {
  const occurrences = resolution.occurrences ?? [];
  if (occurrences.length === 0) return null;
  if (resolution.low !== null && resolution.low !== undefined) {
    const high = resolution.high ?? resolution.low;
    const overlapping = occurrences.find(([start, end]) => start <= high && end >= resolution.low);
    if (overlapping !== undefined) return overlapping;
  }
  return occurrences[0];
}

/** Compact, diff-legible pin for one fragment: what it is and where it resolved. */
export function pinFragment(resolution) {
  if (SKIPPED_STATUSES.has(resolution.status)) return resolution.status;
  const where = (resolution.occurrences ?? [])
    .map(([start, end]) => (start === end ? String(start) : `${String(start)}-${String(end)}`))
    .join(",");
  const level =
    resolution.level === undefined || resolution.level === null ? "" : `/${resolution.level}`;
  const flags = `${resolution.outsideSpan === true ? "!span" : ""}${resolution.crossFile === true ? "!file" : ""}${resolution.repeat === true ? "~repeat" : ""}`;
  return `${resolution.status}${level}@${where === "" ? "-" : where}${flags}`;
}

/** True when the cited file is committed evidence, which is frozen by convention. */
export function isFrozenEvidence(relativePath) {
  return (
    relativePath.startsWith("docs/evidence/") &&
    !relativePath.startsWith("docs/evidence/criteria-closeout/")
  );
}

/**
 * Resolves every content-checkable citation in one loaded record.
 * Returns one entry per citation, in document order.
 */
export function resolveRecord(recordName, record, load, resolvePath) {
  const results = [];
  for (const criterion of record.criteria) {
    const seen = new Map();
    for (const citation of criterion.citations ?? []) {
      if (!RESOLVABLE_KINDS.has(citation.kind)) continue;
      const ordinal = seen.get(citation.ref) ?? 0;
      seen.set(citation.ref, ordinal + 1);
      const span = parseRef(citation.ref);
      const fileIndex = load(span.relativePath);
      const referenceDirectory = path.posix.dirname(span.relativePath);
      const entry = {
        key: citationKey(recordName, criterion.index, citation.ref, ordinal),
        record: recordName,
        criterion: criterion.index,
        ticked: criterion.ticked,
        kind: citation.kind,
        ref: citation.ref,
        relativePath: span.relativePath,
        frozen: isFrozenEvidence(span.relativePath),
        refStatus: "OK",
        fragments: [],
        notes: [],
      };
      if (fileIndex === null) {
        entry.refStatus = "FILE-MISSING";
      } else if (span.high !== null && span.high > fileIndex.lineCount) {
        entry.refStatus = `SPAN-PAST-EOF@${String(fileIndex.lineCount)}`;
      }
      const assertion = citation.quotedAssertion ?? "";
      if (assertion !== "" && fileIndex !== null) {
        const parsed = parseQuotedAssertion(assertion, span.relativePath);
        entry.declarations = parsed.declarations;
        for (const fragment of parsed.fragments) {
          const resolution = resolveFragment(fragment, load, resolvePath, referenceDirectory, span);
          // Rule 2, containment half — measured against where the text ACTUALLY
          // is, not against the marker beside it. A fragment quoted from :28
          // under a `ref` of :137 is out of span whether or not it carries its
          // own marker, and that shape is four of the audit's findings.
          if (resolution.filePath !== undefined && resolution.filePath !== span.relativePath) {
            resolution.crossFile = true;
          } else if (span.low !== null && !SKIPPED_STATUSES.has(resolution.status)) {
            const anchor = anchorOccurrence(resolution);
            if (anchor !== null && (anchor[0] < span.low || anchor[1] > span.high)) {
              resolution.outsideSpan = true;
            }
          }
          entry.fragments.push({
            text: fragment.text,
            marker:
              fragment.low === null
                ? span.low === null
                  ? "(file)"
                  : `:${String(span.low)}(ref)`
                : `:${String(fragment.low)}${fragment.high !== fragment.low ? `-${String(fragment.high)}` : ""}`,
            notes: fragment.notes,
            resolution,
          });
        }
        entry.notes = groupConsecutivenessNotes(entry.fragments);
      } else if (assertion === "") {
        entry.notes.push("no quotedAssertion — nothing to content-check");
      }
      entry.pins = entry.fragments.map((fragment) => pinFragment(fragment.resolution));
      entry.stale = entry.fragments.filter((fragment) =>
        STALE_STATUSES.has(fragment.resolution.status),
      );
      results.push(entry);
    }
  }
  return results;
}

/** Occurrence census for a fragment at one rung — used by the report's repeat-text rule. */
export function repeatCensus(fileIndex, text, level) {
  return occurrencesAtLevel(fileIndex, text, level).length;
}
