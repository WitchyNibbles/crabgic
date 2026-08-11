/**
 * `report.render` — the manager channel's structured rendering path.
 *
 * `docs/design/format-gate-production.md` §L1. The CLI needs no format gate
 * because its output goes through a renderer; the manager channel has one
 * precisely because nothing structures its output. This is the affordance that
 * closes that gap: the manager hands over `{role, lead, sections, nextAction}`
 * and gets back markdown that satisfies the policy by construction.
 *
 * WHY A GATEWAY TOOL AND NOT A CLI COMMAND OR A SKILL. All three were costed in
 * the design. A skill is instructions, not execution — it cannot run a renderer,
 * so it collapses into the instruction that already exists. A `crabgic report`
 * command would work, but the manager would be shelling out to format its own
 * message. A tool is the only one the manager calls natively, which is the whole
 * point of making the correct path the easy one.
 *
 * IT CANNOT COMPEL ANYTHING, and that is by design rather than a shortfall. The
 * final assistant message is free text whatever this returns. What it changes is
 * the cost of getting it right: "format it correctly from memory" becomes "call
 * the thing that formats it". The `Stop` gate stays as the backstop for the
 * turns where it is not called.
 *
 * NO AUTHORITY, NO I/O, NO STATE. This tool reads nothing, writes nothing, and
 * reaches no network or filesystem — it is a pure function of its arguments. It
 * is therefore the one tool in the registry that needs no capability grant, no
 * connection, and no journal entry, and it is listed among the families whose
 * surface is recorded in `build-tool-registry.test.ts`.
 */
import { z } from "zod";
import { renderMarkdownReport, PRESENTATION_GLYPH_ROLES } from "@crabgic/contracts";
import type { MarkdownReport } from "@crabgic/contracts";

export const REPORT_RENDER_TOOL = {
  name: "report.render",
  description:
    "Render a report as markdown that satisfies the owner's presentation policy: answer first, " +
    "headed, bulleted, capped, and signposted with the closed glyph vocabulary. Use it for any " +
    "report longer than a couple of lines; return its output as your reply. Short answers need no " +
    "call. Over-long bullets and over-full sections are shortened and the shortfall is stated.",
} as const;

const SECTION_SHAPE = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  table: z
    .object({
      headers: z.array(z.string()).min(1),
      rows: z.array(z.array(z.string())),
    })
    .optional(),
});

/**
 * The wire shape. Deliberately mirrors `MarkdownReport` rather than inventing a
 * flatter one: a caller that has to reshape its data before calling is a caller
 * that will hand-render instead.
 */
export const REPORT_RENDER_SHAPE = {
  role: z.enum(PRESENTATION_GLYPH_ROLES).optional(),
  lead: z.string().min(1),
  sections: z.array(SECTION_SHAPE).optional(),
  nextAction: z.string().optional(),
};

/**
 * Derived from the zod object, not hand-mapped over the shape's keys. A mapped
 * type marks every key REQUIRED even where the schema says optional, so callers
 * omitting `sections` failed to typecheck while the tests passed — vitest does
 * not typecheck, and the pre-push hook is what caught it.
 */
export type ReportRenderArgs = z.infer<z.ZodObject<typeof REPORT_RENDER_SHAPE>>;

/**
 * Renders, or explains the refusal.
 *
 * `renderMarkdownReport` THROWS on author-controlled prose that breaks a limit —
 * an over-long lead, a wall of a body, an oversized title. Those throws are the
 * policy working, and the right response is to tell the caller what to fix, not
 * to crash the gateway: a tool that 500s on a long lead teaches the manager to
 * stop calling it, which loses far more than the malformed report cost.
 */
export function runReportRenderTool(
  args: ReportRenderArgs,
): { readonly markdown: string } | { readonly error: string } {
  try {
    return { markdown: renderMarkdownReport(args as MarkdownReport) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
