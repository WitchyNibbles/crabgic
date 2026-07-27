/**
 * The semantic glyph vocabulary every human-facing Crabgic surface draws
 * from — `docs/presentation-policy.md`.
 *
 * WHY A FIXED VOCABULARY. The owner reads structured, signposted text far
 * faster than prose, and an inconsistent marker set defeats the point: a
 * glyph is only a navigation aid if the same shape always means the same
 * thing. Roles are therefore chosen by *meaning*, never by decoration —
 * there is no "sparkle" or "rocket" here, and adding one is a change to
 * this table plus its test, not an ad-hoc string in a call site.
 *
 * WHY THREE PROFILES. The statusline (`packages/plugin/statusline/
 * crabgic-statusline.mjs`) already proved the pattern: a Unicode set for
 * the terminal a human is looking at, and a plain fallback for terminals,
 * fonts and pipes that mangle it. This module generalises that to the rest
 * of the harness and adds the middle rung the CLI already occupies:
 *
 * - `emoji` — an interactive TTY. Full colour-emoji signposting.
 * - `text`  — piped, redirected, or snapshot-captured stdout. BMP symbols
 *             only, single-width, byte-stable. This is what the CLI's
 *             `status --watch` renderer has always emitted, so adopting
 *             this table changes none of its bytes.
 * - `ascii` — 7-bit only, for a terminal with no Unicode coverage at all.
 *
 * The `text` profile deliberately COLLAPSES distinctions the `emoji`
 * profile carries (`pending`, `running` and `info` are all `•`). That is
 * not an oversight: in text mode the accompanying label already carries
 * the distinction, and inventing three lookalike symbols would trade a
 * real readability gain for a false one.
 *
 * SCOPE. Human-facing channels only — the CLI's own stdout and the manager
 * session's prose. Phase 17's `packages/renderer` (outbound PR/Jira/
 * Grafana text) is deliberately excluded and stays emoji-free: its Jira
 * ADF whitelist rejects the `emoji` node outright, and its artifacts are
 * read by third parties, not by the owner. Nothing in `packages/renderer`
 * may import this module.
 */

/**
 * The closed set of states a human-facing surface reports. Ordered by how
 * often they appear in a run report, not alphabetically, so the table
 * below reads top-to-bottom like an actual status line.
 */
export const PRESENTATION_GLYPH_ROLES = [
  /** A check, gate, work unit or command that succeeded. */
  "ok",
  /** A check, gate, work unit or command that failed. */
  "fail",
  /** Succeeded, but degraded or with a caveat the owner should see. */
  "warn",
  /** Halted at one of the seven stop conditions, or at an approval gate. */
  "blocked",
  /** Accepted, not yet started. */
  "pending",
  /** In flight right now. */
  "running",
  /** Paused by an external limit (`parked:rate_limit`), not by a failure. */
  "parked",
  /** An open decision for the owner — the `AskUserQuestion` case. */
  "question",
  /** An evidence reference backing a claim. */
  "evidence",
  /** A neutral note carrying no verdict. */
  "info",
] as const;

export type PresentationGlyphRole = (typeof PRESENTATION_GLYPH_ROLES)[number];

/** Rendering profiles, widest coverage requirement last. */
export const PRESENTATION_PROFILES = ["emoji", "text", "ascii"] as const;

export type PresentationProfile = (typeof PRESENTATION_PROFILES)[number];

export interface PresentationGlyph {
  readonly emoji: string;
  readonly text: string;
  readonly ascii: string;
}

/**
 * The table itself. `as const` makes every entry readonly at the type
 * level — there is no mutable working copy anywhere in this module.
 *
 * The `text` column is load-bearing beyond style: `packages/cli/src/output/
 * status-renderer.ts` emitted `✓`/`✗`/`⏸`/`•` before this table existed and
 * is snapshot-tested, so these four values are pinned by a test above and
 * must not be "improved".
 */
export const PRESENTATION_GLYPHS: Readonly<Record<PresentationGlyphRole, PresentationGlyph>> = {
  ok: { emoji: "✅", text: "✓", ascii: "+" },
  fail: { emoji: "❌", text: "✗", ascii: "x" },
  warn: { emoji: "⚠️", text: "!", ascii: "!" },
  blocked: { emoji: "🛑", text: "⊘", ascii: "#" },
  pending: { emoji: "⏳", text: "•", ascii: "." },
  running: { emoji: "🔄", text: "•", ascii: ">" },
  parked: { emoji: "⏸️", text: "⏸", ascii: "=" },
  question: { emoji: "❓", text: "?", ascii: "?" },
  evidence: { emoji: "📎", text: "▸", ascii: "*" },
  info: { emoji: "ℹ️", text: "•", ascii: "-" },
} as const;

/** Pure lookup — the only supported way to reach a glyph from a call site. */
export function glyph(role: PresentationGlyphRole, profile: PresentationProfile): string {
  return PRESENTATION_GLYPHS[role][profile];
}
