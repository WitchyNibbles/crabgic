/**
 * `renderer-core` — line counter primitive (roadmap/02 In-scope
 * "`renderer-core` module" bullet, Work item 6; consumed by phase 17's
 * `lint()` length-limit stage and phase 08's rendering assembly). Pure,
 * synchronous, no I/O.
 *
 * Edge semantics (deliberately chosen and documented, since the roadmap
 * left this open — "decide and document edge semantics"):
 *
 * - `countLines("")` is `0` — no content is zero lines, not one blank
 *   line. This matters for `CommunicationPolicy` line limits: an empty
 *   candidate should not silently "use up" one of e.g. the review
 *   comment's 6 allowed lines.
 * - CRLF (`\r\n`) is normalized to `\n` before counting, so Windows-style
 *   line endings never inflate the count relative to LF-only text with
 *   the same visible line structure.
 * - A single trailing newline does NOT add a phantom extra blank line:
 *   `"a\nb\n"` is 2 lines, matching the common "N lines of content,
 *   terminated by a final newline" convention (most rendered artifacts —
 *   commit bodies, PR bodies, review comments — are assembled this way).
 * - Text with no trailing newline still counts its final, unterminated
 *   segment as a line: `"a\nb"` is 2 lines. This differs from POSIX
 *   `wc -l`, which counts newline *characters* rather than occupied
 *   lines and would report 1 for `"a\nb"` — this function instead answers
 *   "how many lines does this text occupy," which is the question
 *   `CommunicationPolicy`'s line limits care about.
 * - An interior blank line still counts: `"a\n\nb"` is 3 lines.
 * - A lone newline is 1 line: `countLines("\n")` is `1` (one blank line,
 *   terminated).
 */
export function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const normalized = text.replace(/\r\n/g, "\n");
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return body.split("\n").length;
}
