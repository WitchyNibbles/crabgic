/**
 * `renderer-core` — attribution-token scanner primitive (roadmap/02
 * In-scope "`renderer-core` module" bullet, Work item 6; consumed by
 * phase 17's attribution-neutral-language `lint()` stage — work item 4,
 * "the seeded 'Generated with…'/'Co-Authored-By' fixture" — and phase
 * 08's belt-and-suspenders attribution assertion on published commits,
 * which reuses this exact fixture rather than forking a copy). Pure,
 * synchronous, no I/O.
 *
 * Deliberately implemented WITHOUT regular expressions: every token is
 * matched via `String.prototype.indexOf` in a bounded loop, which has no
 * backtracking behavior at all (unlike a regex alternation/quantifier
 * pattern, which can be driven into catastrophic backtracking by an
 * adversarial input). `indexOf` is linear in the haystack length per scan
 * pass, and rendered artifacts are always short (bounded by
 * `CommunicationPolicy` limits themselves — the longest is the Jira
 * comment's 800 chars), so this stays cheap without needing a more
 * sophisticated string-search algorithm. Line-number lookup is likewise a
 * plain linear scan (see `lineNumberAtIndex` below) for the same reason:
 * simplicity over cleverness is affordable at these input sizes.
 *
 * Token set: the plan's own examples (roadmap/02 renderer-core bullet;
 * phase 17 work item 4) — "Generated with", "Co-Authored-By", and the
 * robot-emoji attribution line Claude Code's own default commit trailers
 * use. This is a fixed, curated list, not a generic ML-style detector —
 * phase 17 layers additional first-person/signature/engine-name detection
 * on top using these same primitives; this scanner's job stops at
 * "did one of these specific tokens appear."
 */

export interface AttributionFinding {
  /** The canonical (display) form of the token that matched, e.g. `"Generated with"`. */
  readonly token: string;
  /** UTF-16 code-unit offset into the original `text` where the match starts (usable directly with `String.prototype.slice`). */
  readonly index: number;
  /** 1-based line number (see `line-counter.ts`'s documented semantics) containing `index`. */
  readonly line: number;
}

interface AttributionTokenDefinition {
  /** Label reported back in findings. */
  readonly token: string;
  /** Lowercased form matched against a lowercased copy of the input text. */
  readonly matchPattern: string;
}

const ATTRIBUTION_TOKEN_DEFINITIONS: readonly AttributionTokenDefinition[] = [
  { token: "Generated with", matchPattern: "generated with" },
  { token: "Co-Authored-By", matchPattern: "co-authored-by" },
  { token: "🤖", matchPattern: "🤖" },
];

/** Canonical display forms, exported for callers that want the raw token list (e.g. fixture authors in 08/17/23). */
export const ATTRIBUTION_TOKENS: readonly string[] = ATTRIBUTION_TOKEN_DEFINITIONS.map(
  (definition) => definition.token,
);

function lineNumberAtIndex(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") {
      line += 1;
    }
  }
  return line;
}

/**
 * Scans `text` for every occurrence of every attribution token, returning
 * one finding per occurrence (never a bare boolean — mirrors phase 17's
 * own `LintFinding` convention of one entry per violation, so a caller can
 * quote the exact offending span back to a regeneration prompt). Findings
 * are sorted by `index` ascending. Returns an empty array for clean text.
 */
export function scanForAttributionTokens(text: string): readonly AttributionFinding[] {
  const findings: AttributionFinding[] = [];
  const lowerText = text.toLowerCase();
  for (const { token, matchPattern } of ATTRIBUTION_TOKEN_DEFINITIONS) {
    let fromIndex = 0;
    for (;;) {
      const index = lowerText.indexOf(matchPattern, fromIndex);
      if (index === -1) {
        break;
      }
      findings.push({ token, index, line: lineNumberAtIndex(text, index) });
      fromIndex = index + matchPattern.length;
    }
  }
  return findings.sort((a, b) => a.index - b.index);
}
