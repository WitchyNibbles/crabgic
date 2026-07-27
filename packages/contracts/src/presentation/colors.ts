/**
 * The owner-facing colour palette — `docs/presentation-policy.md`.
 *
 * WHY COLOUR IS PART OF THE ACCESSIBILITY CONTRACT, NOT A GARNISH. The same
 * reading condition that makes unstructured prose hard to parse makes flat
 * monochrome output easy to slide off: with nothing to catch the eye, there is
 * nothing to return to after a lapse in attention. Colour here is a second
 * navigation channel layered on the glyph vocabulary, not an alternative to it.
 *
 * COLOUR IS NEVER THE ONLY CARRIER. Every coloured element also carries a
 * glyph and a word, so the entire surface survives `NO_COLOR`, a monochrome
 * terminal, colour-vision deficiency, and a copy-paste into a plain-text
 * ticket. `human.ts` asserts this structurally: stripping every escape from a
 * coloured render must yield the uncoloured render, byte for byte. The red/
 * green pairing of `ok` and `fail` is therefore safe — it is reinforcement,
 * never the distinction itself.
 *
 * WHY 256-COLOUR AND THESE HUES. The status line
 * (`packages/plugin/statusline/crabgic-statusline.mjs`) already ships a muted
 * 256-colour palette, and the two surfaces sit in the same terminal seconds
 * apart. The hues below deliberately reuse its values — 114 green, 203 red,
 * 179 amber, 214 orange, 110 blue, 146 lavender, 242 grey — so Crabgic reads
 * as one product rather than two. That file cannot import this one (it is a
 * zero-dependency hot-path script re-run on every token change), so the
 * duplication is intentional and documented rather than a drift bug.
 *
 * Codes are stored as BARE SGR PARAMETERS (`"38;5;114"`), never pre-escaped,
 * so `paint` owns the escape and reset and no call site can emit a half-open
 * sequence.
 */
import { type PresentationGlyphRole } from "./glyphs.js";

/** The SGR reset. Every sequence `paint` opens is closed with this. */
export const SGR_RESET = "\u001b[0m";

const LOW_SALIENCE_GREY = "38;5;242";

/**
 * One hue per glyph role. The four verdict roles — `ok`, `fail`, `warn`,
 * `blocked` — get four distinct hues because they are the ones read under
 * pressure; `blocked` is crimson rather than a bolder red so it cannot be
 * mistaken for `fail` at a glance, since the two call for different actions
 * (a halt is waiting for the owner, a failure is not).
 *
 * `pending` and `info` deliberately share the low-salience grey. Both are
 * "no verdict yet", and dimming them is the point: they should recede so the
 * verdicts stand out. The `text` glyph profile collapses the same pair for the
 * same reason.
 */
export const ROLE_COLORS: Readonly<Record<PresentationGlyphRole, string>> = {
  ok: "38;5;114",
  fail: "38;5;203",
  warn: "38;5;179",
  blocked: "38;5;168",
  pending: LOW_SALIENCE_GREY,
  running: "38;5;110",
  parked: "38;5;214",
  question: "38;5;176",
  evidence: "38;5;146",
  info: LOW_SALIENCE_GREY,
};

/**
 * Layout styles, as opposed to verdict styles. These carry no meaning about
 * the run — they exist so the eye can find the shape of a report without
 * reading it.
 *
 * `lead` and `heading` are bold: they are the two things a reader who has just
 * lost the thread needs to land on. `rule`, `key` and `bullet` are dimmed so
 * the scaffolding recedes behind the content it holds up.
 */
export const STRUCTURE_COLORS = {
  lead: "1",
  heading: "1",
  rule: LOW_SALIENCE_GREY,
  key: LOW_SALIENCE_GREY,
  bullet: LOW_SALIENCE_GREY,
} as const;

/**
 * Wraps `text` in `code` when `enabled`, otherwise returns it unchanged.
 *
 * Empty text returns empty: a bare colour change followed by a reset is dead
 * weight in the stream and, worse, survives `stripAnsi` comparisons as a
 * phantom difference.
 */
export function paint(code: string, text: string, enabled: boolean): string {
  if (!enabled || text.length === 0) return text;
  return `\u001b[${code}m${text}${SGR_RESET}`;
}

/** Matches any SGR sequence `paint` can emit. */
// eslint-disable-next-line no-control-regex
const SGR_PATTERN = /\u001b\[[0-9;]*m/g;

/**
 * Removes every escape sequence. Used by the renderer's own tests to prove
 * colour changes nothing but colour, and available to any caller that needs
 * to measure or persist rendered text.
 */
export function stripAnsi(text: string): string {
  return text.replace(SGR_PATTERN, "");
}

/**
 * Convenience for the common case: paint a string in its role's hue.
 *
 * No runtime completeness guard is needed — `ROLE_COLORS`'
 * `Record<PresentationGlyphRole, string>` type makes a missing role a compile
 * error, so adding a role to the union cannot ship uncoloured.
 */
export function paintRole(role: PresentationGlyphRole, text: string, enabled: boolean): string {
  return paint(ROLE_COLORS[role], text, enabled);
}
