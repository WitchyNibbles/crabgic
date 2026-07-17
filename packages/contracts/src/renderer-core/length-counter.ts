/**
 * `renderer-core` — length counter primitive (roadmap/02 In-scope
 * "`renderer-core` module" bullet, Work item 6; consumed by phase 17's
 * `lint()` length-limit stage and phase 08's rendering assembly, per
 * interface-ledger's "`renderer-core` module" row). Pure, synchronous, no
 * I/O, no dependency on `CommunicationPolicy` — a bare counting primitive.
 *
 * Counts Unicode *code points*, not UTF-16 code units: `text.length`
 * counts a surrogate-pair codepoint (e.g. many emoji, astral-plane
 * characters) as 2, which over-counts human-perceived length. `Array.from`
 * iterates a string by code point, so a surrogate pair collapses back to 1
 * — this matters directly for phase 17's attribution stage, whose robot-
 * emoji fixture (`renderer-core`'s own `attribution-scanner.ts`) is a
 * surrogate pair.
 *
 * Known limitation (documented, not solved here): this does NOT perform
 * grapheme-cluster segmentation — a combining-mark sequence (e.g. "e" +
 * U+0301 COMBINING ACUTE ACCENT) counts as 2 code points even though it
 * renders as one visual character. Phase 17's Unicode NFC-normalization
 * stage runs upstream of any length check and collapses the common
 * composed/decomposed drift before this counter is ever called; full
 * `Intl.Segmenter`-based grapheme counting is out of scope for this
 * primitive (17 owns the Unicode-defense stage; this module owns only the
 * counting primitive it calls into).
 *
 * Edge cases:
 * - `countChars("")` is `0`.
 * - A trailing newline counts as 1 char (line semantics live in
 *   `line-counter.ts`, not here — the two counters are independent).
 * - CRLF (`\r\n`) is 2 chars (`\r` and `\n`); no CRLF normalization
 *   happens in this function (contrast `countLines`, which does
 *   normalize CRLF, because line-splitting semantics require it and
 *   char-counting semantics do not).
 */
export function countChars(text: string): number {
  return Array.from(text).length;
}
