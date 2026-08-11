import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, SchemaVersionField } from "../shared/schema-version.js";
import {
  PRESENTATION_GLYPHS,
  PRESENTATION_GLYPH_ROLES,
  type PresentationGlyphRole,
} from "./glyphs.js";

/**
 * `PresentationPolicy` — the shape of what Crabgic says TO ITS OWNER, as
 * opposed to `CommunicationPolicy`, which is the shape of what Crabgic says
 * to everyone else. See `docs/presentation-policy.md`.
 *
 * WHY THIS IS SEPARATE FROM `CommunicationPolicy`. They pull in opposite
 * directions and merging them would corrupt both. `CommunicationPolicy`
 * governs outbound artifacts (PR bodies, Jira comments, Grafana
 * annotations) read by third parties: neutral voice, no decoration, no
 * emoji — phase 17's Jira ADF whitelist rejects the `emoji` node outright.
 * `PresentationPolicy` governs the owner-facing channel, where signposting
 * is the whole point. One file, two audiences, two sets of rules.
 *
 * WHY IT IS AN ACCESSIBILITY CONTRACT, NOT A STYLE PREFERENCE. Long
 * unstructured prose is not merely less pleasant for this product's owner
 * to read — it is hard to parse at all. Every limit below is therefore a
 * floor on legibility, and "the answer was technically in there somewhere"
 * is a defect, not a defence.
 *
 * WHERE IT LIVES. `packages/contracts/src/presentation/` is a module inside
 * `packages/contracts`, in the manner of `renderer-core` (interface-ledger
 * Gap 3) and `cli-surface` — NOT a new workspace package, and NOT one of
 * the 21 roadmap contracts. It is consumed by `packages/cli` (human-mode
 * stdout) and `packages/plugin` (the manager session's operating protocol).
 * `packages/renderer` must never import it.
 */

/**
 * The structural limits a human-facing report satisfies. Every value is a
 * budget, not a target: coming in under one is always fine.
 *
 * - `leadAnswerMaxLines` — the conclusion goes FIRST, in at most this many
 *   lines. A reader who stops after the lead must still have the answer.
 * - `headingRequiredAboveLines` — past this length a report needs headings.
 *   This is the single rule that turns a wall into a document.
 * - `proseBlockMaxLines` — the longest unbroken paragraph. Held strictly
 *   below `headingRequiredAboveLines` so that prose can never grow into a
 *   wall in the gap between the two rules.
 * - `bulletMaxWords` — a bullet must be scannable in one fixation.
 * - `sectionMaxBullets` — past this, split the section or use a table.
 * - `tableMinRows` — at this many items carrying two or more attributes
 *   each, a table beats a list.
 * - `bulletMaxColumns` — a bullet's DISPLAY WIDTH, in terminal columns.
 *   Bounds what `bulletMaxWords` cannot: one 500-character token — a digest, a
 *   URL, a stack frame — is a single word and a horizontal wall. Both apply,
 *   and whichever bites first wins, because they bound different failure
 *   modes (many short words vs. one huge one).
 * - `titleMaxColumns` — a section title's display width. Turns the standing
 *   claim that "section titles are plain single-width text by contract" into
 *   something checked rather than asserted in a comment.
 */
export const HUMAN_REPORT_LIMITS = {
  leadAnswerMaxLines: 2,
  headingRequiredAboveLines: 5,
  proseBlockMaxLines: 3,
  bulletMaxWords: 15,
  sectionMaxBullets: 7,
  tableMinRows: 3,
  bulletMaxColumns: 100,
  titleMaxColumns: 40,
} as const;

const HumanReportLimitsSchema = z
  .object({
    leadAnswerMaxLines: z.number().int().positive(),
    headingRequiredAboveLines: z.number().int().positive(),
    proseBlockMaxLines: z.number().int().positive(),
    bulletMaxWords: z.number().int().positive(),
    sectionMaxBullets: z.number().int().positive(),
    tableMinRows: z.number().int().positive(),
    bulletMaxColumns: z.number().int().positive(),
    titleMaxColumns: z.number().int().positive(),
  })
  .strict();

const PresentationGlyphSchema = z
  .object({
    emoji: z.string().min(1),
    text: z.string().min(1),
    ascii: z.string().min(1),
  })
  .strict();

/**
 * Every role must be present. Built from `PRESENTATION_GLYPH_ROLES` rather
 * than restated, so adding a role to the union fails this schema until the
 * table is filled in — the drift can't land silently.
 */
const GlyphTableSchema = z
  .object(
    Object.fromEntries(
      PRESENTATION_GLYPH_ROLES.map((role) => [role, PresentationGlyphSchema]),
    ) as Record<PresentationGlyphRole, typeof PresentationGlyphSchema>,
  )
  .strict();

/**
 * Models a policy *instance* — limits plus the glyph table that instance
 * renders with — rather than a bag of constants, matching
 * `CommunicationPolicySchema`'s precedent, so a future variant (a
 * lower-signposting profile, say) is a data change and not a shape change.
 */
export const PresentationPolicySchema = z
  .object({
    schemaVersion: SchemaVersionField,
    limits: HumanReportLimitsSchema,
    glyphs: GlyphTableSchema,
  })
  .strict();

export type PresentationPolicy = z.infer<typeof PresentationPolicySchema>;

/**
 * The canonical instance every consumer reads. Round-tripped through
 * `.parse` — not merely type-asserted — so drift between the constants
 * above and the schema shape fails at module-load time rather than at
 * `tsc -b`, matching `DEFAULT_COMMUNICATION_POLICY`.
 */
export const DEFAULT_PRESENTATION_POLICY: PresentationPolicy = PresentationPolicySchema.parse({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  limits: HUMAN_REPORT_LIMITS,
  glyphs: PRESENTATION_GLYPHS,
});
