/**
 * A block-level markdown tokenizer, for the manager report-format gate.
 *
 * WHY THIS REPLACED LINE REGEXES. The gate's first implementation classified
 * each line independently with a handful of patterns. That is not enough to
 * decide "is this prose?", because in CommonMark the answer depends on what
 * came BEFORE the line — inside a fence everything is code, under a list item a
 * continuation line belongs to the bullet, and a line of dashes turns the
 * paragraph above it into a heading. Line-at-a-time classification has to guess
 * at all three, and review already found one guess that cost a false positive
 * (fenced content counted toward the structure threshold, so an ordinary
 * "here is the fix: <code block>" answer was blocked).
 *
 * A false positive is this gate's expensive failure — it runs on every session
 * end, and a wrongly-refused turn teaches the owner to distrust it. So the
 * classifier stops guessing and carries state.
 *
 * SCOPE, STATED HONESTLY. This is not a CommonMark implementation and does not
 * try to be. It answers exactly one question — which lines are PROSE the reader
 * has to wade through — and it resolves everything ambiguous toward "not
 * prose", because under-reporting a wall costs one hard-to-read answer while
 * over-reporting one costs a wasted turn. Inline syntax is not parsed at all.
 *
 * A plain `.mjs` under `hooks/`, imported by the gate as a sibling: the engine
 * loads hooks directly and they cannot import the workspace package. Its tests
 * import it the same way.
 */

/** An opening fence: three or more backticks or tildes, up to three spaces indented. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** ATX heading: 1-6 `#` followed by a space or end of line. */
const ATX_HEADING = /^ {0,3}#{1,6}(\s|$)/;
/** Setext underline: a run of `=` or `-` under a paragraph. */
const SETEXT_UNDERLINE = /^ {0,3}(={1,}|-{1,})\s*$/;
/** Bullet or ordered list marker. */
const LIST_MARKER = /^(\s*)([-*+•]|\d{1,9}[.)])(\s+)/;
/** A thematic break — three or more `-`, `_` or `*`, which is NOT a setext underline. */
const THEMATIC_BREAK = /^ {0,3}((-\s*){3,}|(_\s*){3,}|(\*\s*){3,})$/;
/** Blockquote. */
const BLOCKQUOTE = /^ {0,3}>/;
/** A table row, with or without a leading pipe, and the delimiter row. */
const TABLE_PIPE = /^\s*\|/;
const TABLE_DELIMITER = /^\s*:?-{1,}:?(\s*\|\s*:?-{1,}:?)+\s*\|?\s*$/;
/** An HTML block opener. */
const HTML_BLOCK = /^ {0,3}<[!/a-zA-Z]/;
/** A link reference definition: `[label]: destination`. */
const LINK_REFERENCE = /^ {0,3}\[[^\]]+\]:\s*\S/;
/** Four-space (or tab) indented code, outside a list. */
const INDENTED_CODE = /^(?: {4}|\t)/;

/**
 * The block kinds this distinguishes. Only `paragraph` is prose; everything
 * else is structure, code, or quoted material.
 */
export const BLOCK_KINDS = Object.freeze([
  "paragraph",
  "heading",
  "list",
  "code",
  "table",
  "quote",
  "html",
  "reference",
  "break",
  "blank",
]);

/**
 * Classifies every line of `message` into a block kind, carrying the state that
 * makes the classification correct: fence nesting, list continuation, and the
 * setext lookbehind that retroactively turns a paragraph into a heading.
 *
 * @returns an array of `{kind, text, index}`, one per input line.
 */
export function tokenizeBlocks(message) {
  const lines = message.split("\n");
  const out = [];

  /** The fence we are inside, or null. CommonMark closes on the same char, at least as long. */
  let fence = null;
  /** True while the previous line belonged to a list item, so an indented line continues it. */
  let inList = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const blank = line.trim().length === 0;

    if (fence !== null) {
      const close = FENCE_OPEN.exec(line);
      // A closing fence must use the same character and be at least as long —
      // which is why a ```` ``` ```` inside a ```` ~~~ ```` block does not end it,
      // and a shorter run does not either.
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) {
        fence = null;
      }
      out.push({ kind: "code", text: line, index: i });
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = { char: open[1][0], length: open[1].length };
      out.push({ kind: "code", text: line, index: i });
      inList = false;
      continue;
    }

    if (blank) {
      out.push({ kind: "blank", text: line, index: i });
      // A blank line ends a list's lazy continuation for this classifier's
      // purposes. A loose list's second paragraph reads as prose, which is the
      // conservative direction only in the sense that it is what a reader sees.
      inList = false;
      continue;
    }

    // SETEXT IS TESTED BEFORE THEMATIC BREAK, and the order is load-bearing.
    // A `---` line matches both patterns, and CommonMark resolves it as a
    // setext heading whenever there is a paragraph directly above to attach to;
    // it is a thematic break only when there is not. Testing the break first
    // classified `Findings\n------` as prose followed by a rule, losing the one
    // heading in the message.
    //
    // The promotion rewrites what was already emitted, which is the only way a
    // single forward pass can get a retroactive rule right.
    if (SETEXT_UNDERLINE.test(line) && out.length > 0) {
      const previous = out[out.length - 1];
      if (previous.kind === "paragraph") {
        previous.kind = "heading";
        out.push({ kind: "heading", text: line, index: i });
        inList = false;
        continue;
      }
    }

    if (THEMATIC_BREAK.test(line)) {
      out.push({ kind: "break", text: line, index: i });
      inList = false;
      continue;
    }

    if (ATX_HEADING.test(line)) {
      out.push({ kind: "heading", text: line, index: i });
      inList = false;
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      out.push({ kind: "quote", text: line, index: i });
      inList = false;
      continue;
    }

    if (LINK_REFERENCE.test(line)) {
      out.push({ kind: "reference", text: line, index: i });
      inList = false;
      continue;
    }

    if (TABLE_PIPE.test(line) || TABLE_DELIMITER.test(line)) {
      out.push({ kind: "table", text: line, index: i });
      inList = false;
      continue;
    }

    if (LIST_MARKER.test(line)) {
      out.push({ kind: "list", text: line, index: i });
      inList = true;
      continue;
    }

    // An indented line CONTINUES a list item rather than starting a code block —
    // this is the distinction a line-at-a-time classifier cannot make, and
    // getting it wrong turns every wrapped bullet into either code or prose.
    if (INDENTED_CODE.test(line)) {
      out.push({ kind: inList ? "list" : "code", text: line, index: i });
      continue;
    }

    if (HTML_BLOCK.test(line)) {
      out.push({ kind: "html", text: line, index: i });
      inList = false;
      continue;
    }

    // A non-indented line directly under a list item is a LAZY continuation of
    // that item, not a new paragraph.
    if (inList) {
      out.push({ kind: "list", text: line, index: i });
      continue;
    }

    out.push({ kind: "paragraph", text: line, index: i });
  }

  return out;
}

/** Every line the reader must actually read as prose. */
export function proseLinesOf(message) {
  return tokenizeBlocks(message)
    .filter((block) => block.kind === "paragraph")
    .map((block) => block.text);
}

/** Consecutive prose lines joined into the paragraphs a reader wades through. */
export function proseParagraphsOf(message) {
  const paragraphs = [];
  let current = [];
  for (const block of tokenizeBlocks(message)) {
    if (block.kind === "paragraph") {
      current.push(block.text.trim());
      continue;
    }
    if (current.length > 0) paragraphs.push(current.join(" "));
    current = [];
  }
  if (current.length > 0) paragraphs.push(current.join(" "));
  return paragraphs;
}

/** True when the message carries any navigational structure at all. */
export function hasStructure(message) {
  return tokenizeBlocks(message).some(
    (block) => block.kind === "heading" || block.kind === "list" || block.kind === "table",
  );
}
