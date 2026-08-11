/**
 * The manager channel's report renderer — `docs/presentation-policy.md`.
 *
 * WHY THIS IS NOT `renderHumanReport`. `docs/design/format-gate-production.md`
 * §L1 proposed rendering manager reports through `renderHumanReport` itself,
 * "the same function, so the two channels cannot drift". That was wrong, and
 * the policy document already said why: the two channels have **opposite
 * contrast mechanisms**. CLI stdout owns a real terminal and paints it with SGR
 * codes and box-drawing rules; the manager writes into a markdown-rendering TUI
 * that cannot emit ANSI, where the contrast controls are `**bold**` and
 * `` `code` ``. Sharing the renderer would have emitted `────────` underlines
 * into a surface that renders `##` properly, which is worse output justified by
 * a tidier dependency graph.
 *
 * WHAT IS SHARED IS THE PART THAT MATTERS: the limits, and the enforcement of
 * them. Both renderers read `HUMAN_REPORT_LIMITS`, both cap a section at
 * `sectionMaxBullets`, both elide at `bulletMaxWords`/`bulletMaxColumns`, and
 * both announce what they dropped. The policy is one policy; only its spelling
 * differs per channel.
 *
 * WHAT THIS DOES NOT DO. It cannot make the manager USE it — the final
 * assistant message is free text either way. It converts "format it correctly
 * from memory" into "call the thing that formats it", which is the same move
 * `renderHumanReport` made for the CLI, and leaves the `Stop` gate as the
 * backstop for when it is not called.
 */
import { DEFAULT_PRESENTATION_POLICY } from "./presentation-policy.js";
import { glyph } from "./glyphs.js";
import type { PresentationGlyphRole } from "./glyphs.js";
import { displayWidth, truncateToWidth } from "../renderer-core/display-width.js";

export interface MarkdownReportSection {
  readonly title: string;
  /** Prose, capped at `proseBlockMaxLines`. */
  readonly body?: string;
  readonly bullets?: readonly string[];
  /** A markdown table. Header cells first, then rows. */
  readonly table?: {
    readonly headers: readonly string[];
    readonly rows: readonly (readonly string[])[];
  };
}

export interface MarkdownReport {
  /** The verdict role, rendered as the emoji glyph the vocabulary assigns it. */
  readonly role?: PresentationGlyphRole;
  /** The answer, first. At most `leadAnswerMaxLines` lines. */
  readonly lead: string;
  readonly sections?: readonly MarkdownReportSection[];
  /** The single next action. Rendered last, because that is where a reader looks for it. */
  readonly nextAction?: string;
}

/** Shared with `human-report.ts` in intent; spelled separately because the cut marker differs per channel. */
function elide(text: string, maxWords: number, maxColumns: number): string {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const byWords = words.length <= maxWords ? text : `${words.slice(0, maxWords).join(" ")} …`;
  if (displayWidth(byWords) <= maxColumns) return byWords;
  const room = Math.max(0, maxColumns - 2);
  const cut = truncateToWidth(byWords, room);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = lastSpace > room / 2 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(/\s+$/, "")} …`;
}

/**
 * Renders a report as markdown for the manager's TUI.
 *
 * Enforces the same limits as `renderHumanReport`, the same way: prose THROWS
 * (an author typed it, so a wall is a programming error), data DEGRADES (its
 * length is not knowable when the code is written, and crashing a report
 * because a finding was wordy is worse than shortening it).
 */
export function renderMarkdownReport(report: MarkdownReport): string {
  const {
    leadAnswerMaxLines,
    proseBlockMaxLines,
    bulletMaxWords,
    sectionMaxBullets,
    bulletMaxColumns,
    titleMaxColumns,
    tableMinRows,
  } = DEFAULT_PRESENTATION_POLICY.limits;

  const leadLines = report.lead.split("\n").length;
  if (leadLines > leadAnswerMaxLines) {
    throw new Error(
      `renderMarkdownReport: lead is ${String(leadLines)} lines, over the ${String(leadAnswerMaxLines)}-line budget — move the detail into a section`,
    );
  }

  const blocks: string[] = [];
  // The glyph is the emoji profile deliberately: this channel is the one the
  // vocabulary's emoji column exists for, and it is the only channel where
  // `text`/`ascii` degradation is never needed.
  const marker = report.role !== undefined ? `${glyph(report.role, "emoji")} ` : "";
  blocks.push(`${marker}**${report.lead}**`);

  for (const section of report.sections ?? []) {
    const titleWidth = displayWidth(section.title);
    if (titleWidth > titleMaxColumns) {
      throw new Error(
        `renderMarkdownReport: section title is ${String(titleWidth)} columns, over the ${String(titleMaxColumns)}-column budget`,
      );
    }
    const parts: string[] = [`## ${section.title}`];

    if (section.body !== undefined && section.body.length > 0) {
      const bodyLines = section.body.split("\n").length;
      if (bodyLines > proseBlockMaxLines) {
        throw new Error(
          `renderMarkdownReport: section "${section.title}" has a ${String(bodyLines)}-line prose block, over the ${String(proseBlockMaxLines)}-line budget — split it into bullets or another section`,
        );
      }
      parts.push(section.body);
    }

    const all = section.bullets ?? [];
    const kept = all.slice(0, sectionMaxBullets);
    if (kept.length > 0) {
      parts.push(
        kept.map((item) => `- ${elide(item, bulletMaxWords, bulletMaxColumns)}`).join("\n"),
      );
    }
    if (all.length > kept.length) {
      // Announced, never silent — the same rule the CLI renderer follows, for
      // the same reason: a truncated list that does not say so reads complete.
      parts.push(`- _… ${String(all.length - kept.length)} more_`);
    }

    if (section.table !== undefined) {
      parts.push(renderTable(section.table, sectionMaxBullets, bulletMaxWords, bulletMaxColumns));
    }

    blocks.push(parts.join("\n\n"));
  }

  if (report.nextAction !== undefined && report.nextAction.length > 0) {
    blocks.push(`**Next:** ${report.nextAction}`);
  }

  // `tableMinRows` is advisory here rather than enforced: it says when a table
  // BEATS a list, which is a judgement about content the renderer cannot make
  // for a caller that has already chosen. Recorded so the omission is not read
  // as an oversight.
  void tableMinRows;

  return `${blocks.join("\n\n")}\n`;
}

function renderTable(
  table: NonNullable<MarkdownReportSection["table"]>,
  maxRows: number,
  maxWords: number,
  maxColumns: number,
): string {
  const cell = (text: string): string => elide(text, maxWords, maxColumns).replace(/\|/g, "\\|");
  const kept = table.rows.slice(0, maxRows);
  const lines = [
    `| ${table.headers.map(cell).join(" | ")} |`,
    `| ${table.headers.map(() => "---").join(" | ")} |`,
    ...kept.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ];
  if (table.rows.length > kept.length) {
    lines.push(
      `| _… ${String(table.rows.length - kept.length)} more_ |${" |".repeat(Math.max(0, table.headers.length - 1))}`,
    );
  }
  return lines.join("\n");
}
