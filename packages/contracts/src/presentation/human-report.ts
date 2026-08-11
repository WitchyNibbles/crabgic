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
import { DEFAULT_PRESENTATION_POLICY } from "./presentation-policy.js";
import { STRUCTURE_COLORS, paint, paintRole } from "./colors.js";
import { glyph, type PresentationGlyphRole, type PresentationProfile } from "./glyphs.js";
import type { PresentationContext } from "./profile.js";
import { displayWidth, truncateToWidth } from "../renderer-core/display-width.js";

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
 * The rule is drawn to the title's DISPLAY WIDTH, and the title is checked
 * against `titleMaxColumns`. This file previously used `title.length` and
 * asserted in prose that titles are "plain single-width text by contract" —
 * a contract nothing enforced, and which a CJK title silently broke (8 columns
 * of title, 4 columns of rule).
 */
export function renderHeading(title: string, ctx: PresentationContext): string {
  if (title.length === 0) throw new Error("renderHeading: title must not be empty");
  // Columns, not `title.length`. Measured before this changed: the 8-column
  // title `評価結果` got a 4-column rule, because `.length` is 4. The
  // "titles are plain single-width text by contract" note this file used to
  // carry was a comment where a check belonged — here is the check.
  const width = displayWidth(title);
  const { titleMaxColumns } = DEFAULT_PRESENTATION_POLICY.limits;
  if (width > titleMaxColumns) {
    throw new Error(
      `renderHeading: title is ${String(width)} columns, over the ${String(titleMaxColumns)}-column budget — shorten it`,
    );
  }
  const rule = HEADING_RULE[ctx.profile].repeat(width);
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
  // Padding measured in COLUMNS. `padEnd` on `.length` sheared the value column
  // by one space per wide character — measured, in the one function whose
  // entire purpose is alignment: keys `run` and `実行` started their values at
  // column 5 and column 7 respectively.
  const width = Math.max(...rows.map((row) => displayWidth(row.key)));
  return rows
    .map((row) => {
      const gap = " ".repeat(Math.max(0, width - displayWidth(row.key)) + KEY_VALUE_GAP);
      const painted = `${paint(STRUCTURE_COLORS.key, row.key, ctx.color)}${gap}${row.value}`;
      return row.value.length === 0 ? painted.replace(/\s+$/, "") : painted;
    })
    .join("\n");
}

/**
 * Trims a bullet to the policy's budgets, marking the cut.
 *
 * Elision, not rejection: a bullet's text is DATA — a doctor finding's evidence,
 * a path, an engine message — whose length is not knowable when the call site is
 * written. Throwing would convert "this finding has a wordy message" into a
 * crashed command. The `…` is what keeps the shortening honest; `--json` remains
 * the lossless channel, and the overflow line below points at it.
 *
 * TWO BUDGETS, BOTH APPLIED, because they bound different failure modes and
 * neither implies the other:
 *
 *   - `bulletMaxWords` catches many short words.
 *   - `bulletMaxColumns` catches ONE long one. A word budget alone let a single
 *     500-column token — `sha256:<64 hex>`, a URL, a stack frame — through
 *     untouched, which is the horizontal wall this whole policy exists to
 *     prevent. That was the residual reported at merge on 2026-08-11.
 *
 * The column cut falls back through a word boundary where one exists, so an
 * ordinary sentence is not sliced mid-word, and lands on a grapheme boundary
 * always — `truncateToWidth` will drop a whole cluster rather than emit half a
 * surrogate pair.
 */
function elideToBudget(text: string, maxWords: number, maxColumns: number): string {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const byWords = words.length <= maxWords ? text : `${words.slice(0, maxWords).join(" ")} …`;
  if (displayWidth(byWords) <= maxColumns) return byWords;

  // Room for the marker itself, so the result never exceeds the budget.
  const room = Math.max(0, maxColumns - 2);
  const cut = truncateToWidth(byWords, room);
  const lastSpace = cut.lastIndexOf(" ");
  // Prefer a word boundary, but only when it keeps most of the budget — for a
  // single unbroken token there is no boundary to find, and cutting at the
  // last space would throw the whole bullet away.
  const kept = lastSpace > room / 2 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(/\s+$/, "")} …`;
}

export interface HumanReportSection {
  /** Plain, single-width text — see `renderHeading`. */
  readonly title: string;
  /** Optional prose, rendered before the bullets. Capped at `proseBlockMaxLines`. */
  readonly body?: string;
  /**
   * Capped at `sectionMaxBullets`, each elided to `bulletMaxWords`. Overflow is
   * announced rather than dropped silently.
   */
  readonly bullets?: readonly string[];
  /**
   * A two-column table, for the case `tableMinRows` names: three-plus items
   * each carrying two-plus attributes. Same budget as `bullets` — capped at
   * `sectionMaxBullets`, values elided at `bulletMaxWords`, overflow announced.
   *
   * Rendered AFTER `bullets` when a section carries both, though no caller
   * does today; a section that needs a list and a table is usually two
   * sections.
   */
  readonly rows?: readonly KeyValueRow[];
}

/**
 * The line that owns up to a cap having fired, or `undefined` when nothing was
 * dropped.
 *
 * Announced, never silent. A truncated list that does not say it was truncated
 * reads as a complete one — the precise failure mode this policy exists to
 * prevent — so the count and the lossless channel (`--json`) both appear.
 */
function renderOverflow(dropped: number, ctx: PresentationContext): string | undefined {
  if (dropped <= 0) return undefined;
  return `${BULLET_INDENT}${paint(
    STRUCTURE_COLORS.bullet,
    `… ${String(dropped)} more (--json for all)`,
    ctx.color,
  )}`;
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
  const {
    leadAnswerMaxLines,
    proseBlockMaxLines,
    bulletMaxWords,
    sectionMaxBullets,
    bulletMaxColumns,
  } = DEFAULT_PRESENTATION_POLICY.limits;
  const leadLines = report.lead.split("\n").length;
  if (leadLines > leadAnswerMaxLines) {
    throw new Error(
      `renderHumanReport: lead is ${leadLines} lines, over the ${leadAnswerMaxLines}-line budget — move the detail into a section`,
    );
  }

  const blocks = [paint(STRUCTURE_COLORS.lead, report.lead, ctx.color)];
  for (const section of report.sections) {
    const parts = [renderHeading(section.title, ctx)];
    if (section.body !== undefined && section.body.length > 0) {
      // Prose is author-typed, so a wall here is a programming error and throws
      // at the call site that can fix it — unlike the bullets below, whose
      // length is a property of the data and cannot be fixed by the author.
      const bodyLines = section.body.split("\n").length;
      if (bodyLines > proseBlockMaxLines) {
        throw new Error(
          `renderHumanReport: section "${section.title}" has a ${bodyLines}-line prose block, over the ${proseBlockMaxLines}-line budget — split it into bullets or another section`,
        );
      }
      parts.push(section.body);
    }

    const allBullets = section.bullets ?? [];
    const keptBullets = allBullets.slice(0, sectionMaxBullets);
    const bullets = renderBullets(
      keptBullets.map((item) => elideToBudget(item, bulletMaxWords, bulletMaxColumns)),
      ctx,
    );
    if (bullets.length > 0) parts.push(bullets);
    const bulletOverflow = renderOverflow(allBullets.length - keptBullets.length, ctx);
    if (bulletOverflow !== undefined) parts.push(bulletOverflow);

    const allRows = section.rows ?? [];
    const keptRows = allRows.slice(0, sectionMaxBullets);
    if (keptRows.length > 0) {
      // Indented to sit under its heading exactly as the bullets do. The
      // alignment itself is `renderKeyValues`' job, and it measures the PLAIN
      // text before painting — see its own note on why that ordering matters.
      const table = renderKeyValues(
        keptRows.map((row) => ({
          key: row.key,
          value: elideToBudget(row.value, bulletMaxWords, bulletMaxColumns),
        })),
        ctx,
      );
      parts.push(
        table
          .split("\n")
          .map((line) => `${BULLET_INDENT}${line}`)
          .join("\n"),
      );
    }
    const rowOverflow = renderOverflow(allRows.length - keptRows.length, ctx);
    if (rowOverflow !== undefined) parts.push(rowOverflow);

    blocks.push(parts.join("\n"));
  }
  return `${blocks.join("\n\n")}\n`;
}
