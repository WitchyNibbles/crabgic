/**
 * The two human-mode report shapes every CLI command reduces to —
 * `docs/presentation-policy.md`.
 *
 * WHY THIS MODULE EXISTS. Until 2026-08-11 every handler built its own stdout
 * with `lines.join("\n")`. That is how `doctor` came to emit ten flat findings
 * with no lead and no cap while the presentation policy sat in the same repo
 * describing precisely that failure — and how `renderHumanReport`, written for
 * this exact job, ended up with zero production callers. Centralising the two
 * shapes makes the policy the DEFAULT rather than something each of a dozen
 * handlers has to independently remember.
 *
 * THE SPLIT IS BY CARDINALITY, NOT BY COMMAND.
 *
 * - A result with ONE fact ("resumed", "cancelled", "unreachable") gets
 *   `renderResultLine`: a glyph, a word, one line. Pushing that through a
 *   headed report would ADD reading, which is the opposite of the point — a
 *   heading over a single line is scaffolding with nothing to hold up.
 * - A list whose length is not known when the code is written (runs, evidence
 *   records, proposals, connections) gets `renderItemListReport`, which is
 *   answer-first, headed, capped at `sectionMaxBullets` and elided at
 *   `bulletMaxWords`, and which announces anything it dropped.
 *
 * Both are pure and default to the monochrome `text` context, matching
 * `./status-renderer.ts`: piped, redirected and snapshot-captured output stays
 * byte-stable, and a caller that has resolved a real terminal passes a context
 * to get the same layout in colour.
 */
import type { PresentationContext, PresentationGlyphRole } from "@crabgic/contracts";
import { renderHumanReport, renderStatusLine } from "./human.js";

/**
 * The default context for CLI stdout: monochrome `text`.
 *
 * Named once and shared rather than re-declared per module — the same reason
 * `./status-renderer.ts` named its own: two copies that drifted would colour
 * one stream and not another, from code that looks identical.
 */
export const CLI_TEXT: PresentationContext = { profile: "text", color: false };

/**
 * A single-fact result: `<glyph> <text>`, one line, one trailing newline.
 *
 * The newline is included so callers can hand the string straight to
 * `CommandResult.stdout`, whose convention is exactly one.
 */
export function renderResultLine(
  role: PresentationGlyphRole,
  text: string,
  ctx: PresentationContext = CLI_TEXT,
): string {
  return `${renderStatusLine(role, text, ctx)}\n`;
}

/**
 * `3 runs` / `1 run` — the count and its noun, agreeing.
 *
 * Trivial, and here rather than inline at each call site because it was already
 * hand-rolled three times and got it wrong once ("1 proposals"). A lead is the
 * one line the policy guarantees a reader lands on; it should not be the line
 * with the grammar mistake in it.
 */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

export interface ItemListReport {
  /** The glyph role for the lead — the verdict a reader lands on first. */
  readonly role: PresentationGlyphRole;
  /** The conclusion, typically a count. At most `leadAnswerMaxLines` lines. */
  readonly lead: string;
  /** Plain, single-width section title. */
  readonly title: string;
  /** The items. Capped and elided by `renderHumanReport`; overflow is announced. */
  readonly items: readonly string[];
}

/**
 * An answer-first list: the count leads, the items follow under a heading, and
 * anything past the policy's budget is summarised rather than printed.
 */
export function renderItemListReport(
  report: ItemListReport,
  ctx: PresentationContext = CLI_TEXT,
): string {
  return renderHumanReport(
    {
      lead: renderStatusLine(report.role, report.lead, ctx),
      sections: [{ title: report.title, bullets: report.items }],
    },
    ctx,
  );
}
