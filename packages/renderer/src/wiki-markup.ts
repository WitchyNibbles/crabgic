/**
 * `toWikiMarkup` — Jira Data Center wiki-markup fallback profile
 * (roadmap/17 §Interfaces produced; consumed by phase 19). Converts the
 * same constrained markdown subset `toADF` accepts into Jira's classic
 * wiki-markup syntax: `h1.`-`h3.` headings, `*bold*`, `_italic_`,
 * `{{code}}`, `[text|url]` links, `*`/`#` list bullets, `{code}...{code}`
 * fenced blocks, and `bq. ` blockquotes.
 *
 * roadmap/17 §Test plan: "`toWikiMarkup` output checked against 19's own
 * stated exit criterion (\"wiki rendering passes the 17 lint corpus\")" —
 * this module's own test file cross-checks its output against the same
 * corpus fixtures `toADF` and the lint pipeline are checked against.
 */

// Bold is tokenized out FIRST, behind a `*`-free placeholder, so the later
// italic pass (which matches single `*...*`) can never mistake a freshly
// emitted wiki-markup bold marker (`*text*`) for source-level italics — a
// naive chained-replace ordering would otherwise double-convert
// `**bold**` -> `*bold*` -> `_bold_`.
// EXPORTED FOR ONE REASON, stated here so nobody "tidies" it back to private:
// the placeholders are unforgeable ONLY because `unicode-defense.ts`'s
// `UNEXPECTED_CONTROL_PATTERN` blocks U+0000 in every candidate upstream, so no
// source text reaching `toWikiMarkup` can contain one. That is a cross-module
// invariant, and until 2026-08-06 nothing asserted it: rewriting these to
// `@@WIKI_STRONG_OPEN@@` left gateway, learning and renderer green across 74
// files / 785 tests. A printable placeholder is a silent injection surface —
// source text containing the sentinel would be rewritten into bold markers it
// never asked for. `wiki-markup.test.ts` now pins that whatever these hold is
// refused by `unicodeDefenseStage`.
export const BOLD_PLACEHOLDER_OPEN = "\0WIKI_STRONG_OPEN\0";
export const BOLD_PLACEHOLDER_CLOSE = "\0WIKI_STRONG_CLOSE\0";

// Markdown image syntax, converted to Jira's own image syntax (`!url!`)
// BEFORE the link pass — `![alt](url)` contains `[alt](url)`, so a link-first
// ordering would rewrite an image into `![alt|url]`: a stray `!` glued to a
// link, which is neither valid wiki markup nor a faithful conversion.
//
// Why this matters beyond tidiness: `url-policy` blocks embedded remote
// images unconditionally, and it recognizes them by notation. Emitting a
// LINK for an IMAGE handed that stage a construct it permits, so converting
// a blocked artifact produced a clean one. Measured on the phase-17 corpus:
// `attack-remote-image` linted BLOCK(url-policy) as markdown and PASS after
// conversion. Jira wiki markup has no alt-text slot on an image, so the alt
// text is dropped rather than smuggled into a `|params` position it would
// not survive.
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(([^)]+)\)/g;

function convertInline(text: string): string {
  const withImages = text.replace(MARKDOWN_IMAGE_PATTERN, (_match, url: string) => `!${url}!`);
  const withBoldPlaceholders = withImages.replace(
    /\*\*(.+?)\*\*/g,
    (_match, inner: string) => `${BOLD_PLACEHOLDER_OPEN}${inner}${BOLD_PLACEHOLDER_CLOSE}`,
  );
  const withItalics = withBoldPlaceholders
    .replace(/\*(.+?)\*/g, "_$1_")
    .replace(/`(.+?)`/g, "{{$1}}")
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, "[$1|$2]");
  return withItalics.split(BOLD_PLACEHOLDER_OPEN).join("*").split(BOLD_PLACEHOLDER_CLOSE).join("*");
}

export function toWikiMarkup(markdown: string): string {
  const lines = markdown.split("\n");
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
    const orderedMatch = /^\d+\.\s+(.*)$/.exec(line);
    const blockquoteMatch = /^>\s?(.*)$/.exec(line);
    const fenceMatch = /^```/.test(line);

    if (fenceMatch) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      output.push("{code}", ...codeLines, "{code}");
      i += 1;
      continue;
    }

    if (headingMatch) {
      const level = Math.min(headingMatch[1]!.length, 3);
      output.push(`h${level}. ${convertInline(headingMatch[2]!.trim())}`);
      i += 1;
      continue;
    }

    if (bulletMatch) {
      output.push(`* ${convertInline(bulletMatch[1]!)}`);
      i += 1;
      continue;
    }

    if (orderedMatch) {
      output.push(`# ${convertInline(orderedMatch[1]!)}`);
      i += 1;
      continue;
    }

    if (blockquoteMatch) {
      output.push(`bq. ${convertInline(blockquoteMatch[1]!)}`);
      i += 1;
      continue;
    }

    if (line.trim().length === 0) {
      output.push("");
      i += 1;
      continue;
    }

    output.push(convertInline(line));
    i += 1;
  }

  return output
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
