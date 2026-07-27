/**
 * Human-mode stdout primitives — `docs/presentation-policy.md`.
 *
 * The counterpart to `formatJson`. `--json` output is a machine contract and
 * this module must never touch it; everything here is for the stream a person
 * is actually reading. Every function is pure and takes its
 * `PresentationContext` explicitly rather than sniffing `process` — the same
 * reason `resolvePresentation` takes its input: a command handler is built and
 * snapshot-tested without global state, and `bin.ts` stays the sole place that
 * touches the real streams.
 *
 * WHY THE CONTEXT IS PASSED, NOT RESOLVED PER CALL. A single command must not
 * mix glyph profiles or half-apply colour mid-output. The handler calls
 * `resolvePresentation` once at its entry point and threads the result through,
 * so a piped run is uniformly monochrome `text` and a TTY run is uniformly
 * coloured `emoji`.
 *
 * COLOUR IS ADDITIVE ONLY. Every coloured element also carries a glyph and a
 * word, and colour never changes layout: this module's own test asserts that
 * `stripAnsi(coloured) === monochrome`, byte for byte, for every profile. That
 * is what makes the surface survive `NO_COLOR`, a monochrome terminal,
 * colour-vision deficiency, and a paste into a plain-text ticket.
 *
 * The structural limits (lead length, when a heading is required) come from
 * `PresentationPolicy` rather than being retyped here, matching how phase 17's
 * templates read `CommunicationPolicy` at call time.
 */
import {
  DEFAULT_PRESENTATION_POLICY,
  STRUCTURE_COLORS,
  glyph,
  paint,
  paintRole,
  type PresentationContext,
  type PresentationGlyphRole,
  type PresentationProfile,
} from "@crabgic/contracts";

/** Box-drawing rules degrade to a hyphen where Unicode is not safe. */
const HEADING_RULE: Readonly<Record<PresentationProfile, string>> = {
  emoji: "─",
  text: "─",
  ascii: "-",
};

/** The list marker. Distinct from the `info` glyph so a bullet never reads as a status. */
const BULLET: Readonly<Record<PresentationProfile, string>> = {
  emoji: "•",
  text: "•",
  ascii: "-",
};

const BULLET_INDENT = "  ";
/** Columns between the widest key and the value column in `renderKeyValues`. */
const KEY_VALUE_GAP = 2;

/**
 * `<glyph> <text>` — the atom every status report is built from.
 *
 * The WHOLE line takes the role's hue, not just the glyph. A single coloured
 * character is too small to catch a wandering eye; a coloured line is findable
 * without being read, which is the entire point of the colour channel.
 */
export function renderStatusLine(
  role: PresentationGlyphRole,
  text: string,
  ctx: PresentationContext,
): string {
  const marker = glyph(role, ctx.profile);
  const line = text.length === 0 ? marker : `${marker} ${text}`;
  return paintRole(role, line, ctx.color);
}

/**
 * A section break a plain terminal can actually show. Markdown `##` renders as
 * literal hashes in a pipe, so the heading is underlined instead — and the
 * title is bolded while the rule is dimmed, so the scaffolding recedes behind
 * the label it holds up.
 *
 * The rule length is `title.length`, which is correct because section titles
 * are plain single-width text by contract — an emoji or CJK title would
 * mis-measure, so this throws on an empty title and callers keep titles plain.
 */
export function renderHeading(title: string, ctx: PresentationContext): string {
  if (title.length === 0) throw new Error("renderHeading: title must not be empty");
  const rule = HEADING_RULE[ctx.profile].repeat(title.length);
  return `${paint(STRUCTURE_COLORS.heading, title, ctx.color)}\n${paint(
    STRUCTURE_COLORS.rule,
    rule,
    ctx.color,
  )}`;
}

/**
 * Indented bullets, or the empty string, so callers can concatenate
 * unconditionally. Only the marker is dimmed — the item text keeps full
 * contrast, because the text is the content and the marker is furniture.
 */
export function renderBullets(items: readonly string[], ctx: PresentationContext): string {
  const marker = paint(STRUCTURE_COLORS.bullet, BULLET[ctx.profile], ctx.color);
  return items.map((item) => `${BULLET_INDENT}${marker} ${item}`).join("\n");
}

export interface KeyValueRow {
  readonly key: string;
  readonly value: string;
}

/**
 * A two-column block with the values aligned. Keys are dimmed so the values
 * carry the contrast.
 *
 * Padding is computed and trimmed on the PLAIN text and colour applied
 * afterwards. Padding a painted string would count escape bytes as width and
 * shear the value column; trimming one could truncate a reset and bleed colour
 * into the rest of the stream.
 */
export function renderKeyValues(rows: readonly KeyValueRow[], ctx: PresentationContext): string {
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.key.length));
  return rows
    .map((row) => {
      const padded = row.key.padEnd(width + KEY_VALUE_GAP);
      const gap = padded.slice(row.key.length);
      const painted = `${paint(STRUCTURE_COLORS.key, row.key, ctx.color)}${gap}${row.value}`;
      return row.value.length === 0 ? painted.replace(/\s+$/, "") : painted;
    })
    .join("\n");
}

export interface HumanReportSection {
  /** Plain, single-width text — see `renderHeading`. */
  readonly title: string;
  /** Optional prose, rendered before the bullets. */
  readonly body?: string;
  readonly bullets?: readonly string[];
}

export interface HumanReport {
  /** The conclusion, first. Capped at the policy's `leadAnswerMaxLines`. */
  readonly lead: string;
  readonly sections: readonly HumanReportSection[];
}

/**
 * Composes a report that satisfies the policy by construction: the lead comes
 * first, is length-checked and is bolded, and every section carries a heading,
 * so a long report can never be an undifferentiated block.
 *
 * The lead check THROWS rather than truncating. A truncated conclusion is
 * worse than a loud failure — it looks like a complete answer while having
 * dropped the part the reader needed, and the caller is always our own code,
 * never user input, so this is a programming error and should surface as one.
 */
export function renderHumanReport(report: HumanReport, ctx: PresentationContext): string {
  const { leadAnswerMaxLines } = DEFAULT_PRESENTATION_POLICY.limits;
  const leadLines = report.lead.split("\n").length;
  if (leadLines > leadAnswerMaxLines) {
    throw new Error(
      `renderHumanReport: lead is ${leadLines} lines, over the ${leadAnswerMaxLines}-line budget — move the detail into a section`,
    );
  }

  const blocks = [paint(STRUCTURE_COLORS.lead, report.lead, ctx.color)];
  for (const section of report.sections) {
    const parts = [renderHeading(section.title, ctx)];
    if (section.body !== undefined && section.body.length > 0) parts.push(section.body);
    const bullets = renderBullets(section.bullets ?? [], ctx);
    if (bullets.length > 0) parts.push(bullets);
    blocks.push(parts.join("\n"));
  }
  return `${blocks.join("\n\n")}\n`;
}
