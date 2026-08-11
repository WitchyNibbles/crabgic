/**
 * `renderer-core` — display width, in terminal columns.
 *
 * WHY THIS EXISTS. `./length-counter.ts` counts code points and says in its own
 * doc that grapheme segmentation is out of scope for it. That left the repo
 * with four notions of "length" — UTF-16 code units (`text.length`), code
 * points (`countChars`), grapheme clusters (nothing), and display columns
 * (nothing) — and using the first two wherever the fourth was meant.
 *
 * Every limit in `HUMAN_REPORT_LIMITS` is ultimately about how much SCREEN a
 * thing occupies. Two measured consequences of not having this, both latent
 * only because every caller today passes ASCII:
 *
 *   - `renderHeading` drew a 4-column rule under the 8-column title `評価結果`.
 *   - `renderKeyValues` — a function whose entire purpose is alignment — started
 *     its value column at 5 for a `run` key and 7 for a `実行` key.
 *
 * WIDTH IS TERMINAL-DEPENDENT, AND THIS PICKS A CONVENTION RATHER THAN
 * PRETENDING OTHERWISE. `⚠️` (U+26A0 + VS16) is one column in some terminals and
 * two in others; East Asian Ambiguous characters depend on locale. The
 * conventions here, documented in `docs/presentation-policy.md`:
 *
 *   - VS16-qualified and emoji-presentation clusters → 2 (the modern-terminal
 *     default, and what the glyph vocabulary assumes)
 *   - East Asian Ambiguous → 1 (the Western-locale default)
 *
 * ±1 column per emoji is expected and tolerated: the limits are floors on
 * legibility, not layout guarantees. Silent shearing of an ALIGNED column is
 * not tolerable, which is why `renderKeyValues` is the primary consumer.
 *
 * Zero dependencies. `Intl.Segmenter` is used for grapheme clustering — the
 * repo declares `node >= 24` in every manifest, so it is always present.
 */

/** One segmenter, reused: construction is the expensive part. */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Variation Selector-16 — forces emoji presentation, and with it a two-column cell. */
const VS16 = 0xfe0f;

/**
 * Codepoints that occupy no column: format characters (Cf — includes the
 * zero-width space/joiner family `packages/renderer/src/unicode-defense.ts`
 * enumerates), non-spacing and enclosing marks (Mn/Me), and C0/C1 controls.
 *
 * Expressed as Unicode property escapes rather than a hand-kept list, so it
 * cannot drift out of agreement with the one in `unicode-defense.ts` — there is
 * nothing to keep in agreement.
 */
const ZERO_WIDTH = /^[\p{Cf}\p{Mn}\p{Me}\p{Cc}]$/u;

/**
 * Codepoints that render as emoji WITHOUT a variation selector.
 *
 * A property escape, not a range list. The first draft of this file enumerated
 * emoji ranges by hand and got `✅` (U+2705) wrong — it sits below the
 * pictograph blocks — and omitted transport & map symbols (U+1F680–U+1F6FF)
 * entirely, so `🛑` measured one column. The engine already ships the Unicode
 * tables; hand-copying a subset of them was the mistake.
 */
const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}$/u;

/**
 * East Asian Wide (W) and Fullwidth (F) ranges, from Unicode 15.1
 * EastAsianWidth.txt.
 *
 * These stay as ranges because there is no property escape for East Asian
 * Width in JavaScript. Pinned by the fixture table in the test.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo init. consonants
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, Hangul compat, CJK compat
  [0x3400, 0x4dbf], // CJK ext A
  [0x4e00, 0x9fff], // CJK unified
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compat ideographs
  [0xfe10, 0xfe19], // vertical forms
  [0xfe30, 0xfe6f], // CJK compat forms
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6], // fullwidth signs
  [0x20000, 0x2fffd], // CJK ext B+
  [0x30000, 0x3fffd],
];

function isWide(codePoint: number): boolean {
  for (const [lo, hi] of WIDE_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

/** The columns one grapheme cluster occupies. */
function clusterWidth(cluster: string): number {
  const base = cluster.codePointAt(0);
  if (base === undefined) return 0;

  const baseChar = String.fromCodePoint(base);
  if (ZERO_WIDTH.test(baseChar)) return 0;

  // A cluster carrying VS16 anywhere is emoji-presented, and therefore wide —
  // this is what makes `⚠️` (U+26A0, itself narrow) two columns while a bare
  // U+26A0 stays one.
  for (const ch of cluster) {
    if (ch.codePointAt(0) === VS16) return 2;
  }

  // Regional-indicator pairs (flags) segment as one cluster and render as one
  // two-column cell.
  if (base >= 0x1f1e6 && base <= 0x1f1ff) return 2;

  if (EMOJI_PRESENTATION.test(baseChar)) return 2;

  return isWide(base) ? 2 : 1;
}

/**
 * The width of `text` in terminal columns.
 *
 * Additive for non-combining inputs. NOT additive across a grapheme boundary
 * split mid-sequence — `displayWidth("👨") + displayWidth("‍👩")` is 4 while
 * `displayWidth("👨‍👩")` is 2 — which is a property of grapheme clustering, not a
 * defect, and is pinned by a test so nobody asserts the stronger law by mistake.
 */
export function displayWidth(text: string): number {
  let total = 0;
  for (const { segment } of GRAPHEMES.segment(text)) {
    total += clusterWidth(segment);
  }
  return total;
}

/**
 * The longest prefix of `text` fitting in `maxColumns`, cut on a grapheme
 * boundary.
 *
 * Never emits a lone surrogate half or a severed ZWJ sequence: a cluster that
 * does not fit whole is dropped whole. A budget smaller than the first cluster
 * yields the empty string rather than a fragment.
 */
export function truncateToWidth(text: string, maxColumns: number): string {
  if (maxColumns <= 0) return "";
  if (displayWidth(text) <= maxColumns) return text;

  let out = "";
  let used = 0;
  for (const { segment } of GRAPHEMES.segment(text)) {
    const width = clusterWidth(segment);
    if (used + width > maxColumns) break;
    out += segment;
    used += width;
  }
  return out;
}
