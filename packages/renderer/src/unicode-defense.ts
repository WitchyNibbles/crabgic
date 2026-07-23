import type { LintFinding, LintStageInput } from "./lint-types.js";

/**
 * Unicode defense primitives — roadmap/17 work item 2. Covers the
 * "Trojan Source" bidi-override vector (CVE-2021-42574), zero-width/
 * invisible-character smuggling, unexpected control characters, and a
 * curated confusable/homograph heuristic.
 */

export const STAGE_NAME_NFC_NORMALIZATION = "nfc-normalization";
export const STAGE_NAME_UNICODE_DEFENSE = "unicode-defense";

/**
 * NFC-normalizes `text`. Exported standalone (not just embedded in the
 * pipeline stage) because: (a) `renderWithRegeneration` normalizes the
 * final candidate before constructing a `RenderedArtifact`, so stored
 * content is always canonical NFC form (byte-stability requirement); (b)
 * the unicode-defense stage below runs its bidi/zero-width/confusable
 * checks over the normalized copy; (c) the property-test suite proves
 * `normalizeToNfc(normalizeToNfc(x)) === normalizeToNfc(x)` directly against
 * this function.
 */
export function normalizeToNfc(text: string): string {
  return text.normalize("NFC");
}

/**
 * The NFC-normalization pipeline stage itself never rejects anything — it
 * is a preparatory transform step, not a validation gate (roadmap/17's
 * stage-arrow list places it between "strip metadata" and "reject bidi
 * overrides...", i.e. before the stage that actually inspects codepoints).
 * It is kept as its own named stage in the ordered runner purely so the
 * pipeline's declared order matches the spec's arrow-chain literally; it
 * always returns an empty finding set. See `unicode-defense.test.ts` for the
 * documented rationale and the property proof.
 */
export function nfcNormalizationStage(_input: LintStageInput): readonly LintFinding[] {
  return [];
}

// Trojan Source bidi-override control range (CVE-2021-42574):
// U+202A-U+202E (embeddings/overrides/pop) and U+2066-U+2069 (isolates).
// Written with explicit \u escapes (never literal invisible glyphs in
// source) so the exact codepoint range is unambiguous on inspection.
const BIDI_OVERRIDE_PATTERN = /[\u202A-\u202E\u2066-\u2069]/g;

// Zero-width / invisible characters commonly used to smuggle content past
// human review while remaining machine-visible: ZERO WIDTH SPACE (U+200B),
// ZERO WIDTH NON-JOINER (U+200C), ZERO WIDTH JOINER (U+200D), ZERO WIDTH
// NO-BREAK SPACE / BOM (U+FEFF), WORD JOINER (U+2060). L3 fix
// (adversarial-review LOW) additionally folds in LEFT-TO-RIGHT MARK
// (U+200E) and RIGHT-TO-LEFT MARK (U+200F): both render with no visible
// glyph (same smuggling profile as the rest of this set) and were
// previously uncaught.
// Each \u escape below is a deliberate, distinct zero-width codepoint
// matched individually; the rule's "joined character sequence" heuristic
// misfires here because U+200D (ZWJ) can combine with a neighbor visually,
// which is irrelevant to this character CLASS (an alternation, not a
// literal adjacent sequence).
// eslint-disable-next-line no-misleading-character-class -- see comment above
const ZERO_WIDTH_PATTERN = /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u2060]/g;

// L3 fix (adversarial-review LOW): LINE SEPARATOR (U+2028) and PARAGRAPH
// SEPARATOR (U+2029) are real line-break characters that `countLines`
// (renderer-core) never counts (it only splits on `\n`), so a candidate
// could smuggle extra visual lines past the length-limits stage's line
// count. Blocked outright rather than silently normalized to `\n`, since
// this stage only ever rejects (see `lint()`'s own no-mutation contract).
const LINE_PARAGRAPH_SEPARATOR_PATTERN = /[\u2028\u2029]/g;

// Unexpected C0/C1 control characters, excluding the three whitespace
// controls every artifact legitimately carries (\t \n \r).
// eslint-disable-next-line no-control-regex -- deliberate control-character scan
const UNEXPECTED_CONTROL_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Curated confusable (homograph) table — a documented SUBSET of Unicode
 * UTS #39's `confusables.txt`, not the full multi-thousand-entry mapping
 * (roadmap/17 §Risks: "Confusable detection is heuristic — tune against
 * false positives"). Covers the classic Cyrillic/Greek lookalikes for
 * Latin letters most commonly used in homograph/domain-spoofing attacks.
 *
 * Built from explicit `[codepoint, latinLookalike, name]` tuples via
 * `String.fromCodePoint` — never a literal non-ASCII glyph typed directly
 * into source — matching this file's own `\u`-escape convention for the
 * bidi/zero-width patterns above, so every entry's exact codepoint is
 * unambiguous on inspection (and immune to editor/copy-paste mangling).
 *
 * M4 fix (adversarial-review MEDIUM): the original 16-entry table omitted
 * Greek LOWERCASE alpha/beta (only the capitals were covered) and several
 * commonly-abused Cyrillic lowercase singles, so `pαypal.com` (Greek
 * lowercase alpha) and similar passed clean. Broadened per the adversarial
 * review's explicit list; still a curated subset, not the full UTS #39
 * table (see the risk note above — exhaustive digit/script coverage is
 * intentionally out of scope for this heuristic).
 */
const CONFUSABLE_ENTRIES: readonly [codepoint: number, latin: string, name: string][] = [
  [0x0430, "a", "CYRILLIC SMALL LETTER A"],
  [0x0435, "e", "CYRILLIC SMALL LETTER IE"],
  [0x043e, "o", "CYRILLIC SMALL LETTER O"],
  [0x0440, "p", "CYRILLIC SMALL LETTER ER"],
  [0x0441, "c", "CYRILLIC SMALL LETTER ES"],
  [0x0443, "y", "CYRILLIC SMALL LETTER U"],
  [0x0445, "x", "CYRILLIC SMALL LETTER HA"],
  [0x0456, "i", "CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I"],
  [0x0410, "A", "CYRILLIC CAPITAL LETTER A"],
  [0x0415, "E", "CYRILLIC CAPITAL LETTER IE"],
  [0x041e, "O", "CYRILLIC CAPITAL LETTER O"],
  [0x0420, "P", "CYRILLIC CAPITAL LETTER ER"],
  [0x0421, "C", "CYRILLIC CAPITAL LETTER ES"],
  [0x0392, "B", "GREEK CAPITAL LETTER BETA"],
  [0x0391, "A", "GREEK CAPITAL LETTER ALPHA"],
  [0x03bf, "o", "GREEK SMALL LETTER OMICRON"],
  // M4 additions:
  [0x03b1, "a", "GREEK SMALL LETTER ALPHA"],
  [0x03b2, "b", "GREEK SMALL LETTER BETA"],
  [0x0455, "s", "CYRILLIC SMALL LETTER DZE"],
  [0x0458, "j", "CYRILLIC SMALL LETTER JE"],
  [0x0501, "d", "CYRILLIC SMALL LETTER KOMI DE"],
  [0x04bb, "h", "CYRILLIC SMALL LETTER SHHA"],
  [0x051b, "q", "CYRILLIC SMALL LETTER QA"],
  [0x051d, "w", "CYRILLIC SMALL LETTER WE"],
  [0x0475, "v", "CYRILLIC SMALL LETTER IZHITSA"],
];

const CONFUSABLE_TO_LATIN: ReadonlyMap<string, string> = new Map(
  CONFUSABLE_ENTRIES.map(([codepoint, latin]) => [String.fromCodePoint(codepoint), latin]),
);

const CONFUSABLE_PATTERN = new RegExp(`[${[...CONFUSABLE_TO_LATIN.keys()].join("")}]`, "g");

// A "word-ish" run used to scope the mixed-script heuristic to a single
// token (e.g. a domain label) rather than flagging any document that merely
// contains both a Latin sentence and an unrelated non-Latin word elsewhere.
const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}.-]*/gu;

function findAllMatches(text: string, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    matches.push(match);
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return matches;
}

function codepointName(char: string): string {
  const codepoint = char.codePointAt(0);
  return codepoint === undefined
    ? char
    : `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Mixed-script heuristic: a "word" token that contains at least one Latin
 * letter AND at least one character present in the confusable table is
 * flagged as a probable homograph (e.g. Cyrillic `а` inside an otherwise-
 * Latin domain like `pаypal.com`). A token composed ENTIRELY of non-Latin
 * script (no Latin letters at all) is not flagged here — that is legitimate
 * non-Latin content, not a spoofing attempt, per roadmap/17's own risk note
 * ("allow explicit per-connection language allowances").
 */
function findConfusableHomographs(text: string): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const wordMatch of findAllMatches(text, WORD_PATTERN)) {
    const word = wordMatch[0];
    const hasLatin = /[A-Za-z]/.test(word);
    if (!hasLatin) continue;
    for (const charMatch of findAllMatches(word, CONFUSABLE_PATTERN)) {
      const char = charMatch[0];
      const absoluteStart = wordMatch.index + charMatch.index;
      findings.push({
        stage: STAGE_NAME_UNICODE_DEFENSE,
        severity: "block",
        message: `confusable/homograph character ${codepointName(char)} ("${char}", looks like "${CONFUSABLE_TO_LATIN.get(char)}") mixed into Latin-script token "${word}"`,
        span: { start: absoluteStart, end: absoluteStart + char.length },
      });
    }
  }
  return findings;
}

/**
 * The unicode-defense stage: bidi overrides, zero-width smuggling,
 * unexpected control characters, and confusable homographs. Runs its scans
 * against the NFC-normalized copy of `candidate` (see `normalizeToNfc`),
 * consistent with the pipeline's declared stage order (NFC normalization
 * immediately precedes this stage).
 */
export function unicodeDefenseStage(input: LintStageInput): readonly LintFinding[] {
  const text = normalizeToNfc(input.candidate);
  const findings: LintFinding[] = [];

  for (const match of findAllMatches(text, BIDI_OVERRIDE_PATTERN)) {
    findings.push({
      stage: STAGE_NAME_UNICODE_DEFENSE,
      severity: "block",
      message: `bidi-override control character ${codepointName(match[0])} is not permitted (Trojan Source / CVE-2021-42574 vector)`,
      span: { start: match.index, end: match.index + match[0].length },
    });
  }

  for (const match of findAllMatches(text, ZERO_WIDTH_PATTERN)) {
    findings.push({
      stage: STAGE_NAME_UNICODE_DEFENSE,
      severity: "block",
      message: `zero-width/invisible character ${codepointName(match[0])} is not permitted`,
      span: { start: match.index, end: match.index + match[0].length },
    });
  }

  for (const match of findAllMatches(text, UNEXPECTED_CONTROL_PATTERN)) {
    findings.push({
      stage: STAGE_NAME_UNICODE_DEFENSE,
      severity: "block",
      message: `unexpected control character ${codepointName(match[0])} is not permitted`,
      span: { start: match.index, end: match.index + match[0].length },
    });
  }

  for (const match of findAllMatches(text, LINE_PARAGRAPH_SEPARATOR_PATTERN)) {
    findings.push({
      stage: STAGE_NAME_UNICODE_DEFENSE,
      severity: "block",
      message: `line/paragraph separator character ${codepointName(match[0])} is not permitted (bypasses newline-based line counting)`,
      span: { start: match.index, end: match.index + match[0].length },
    });
  }

  findings.push(...findConfusableHomographs(text));

  return findings;
}
