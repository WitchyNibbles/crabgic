/**
 * The Crabgic output style — the manager channel's PREVENTION layer.
 *
 * `docs/design/format-gate-production.md` §L0. An output style replaces the
 * assistant's base communication prompt, so the reporting rules become the
 * model's default register rather than an instruction competing with one. That
 * is categorically stronger than the `Stop` gate, which can only refuse a turn
 * after the wall has been written.
 *
 * WHY THE INSTALLER WRITES IT INSTEAD OF THE PLUGIN SHIPPING IT.
 * `docs/engine-baseline.md` §23, probe `spikes/11-output-style.mjs` at engine
 * 2.1.224: output styles are NOT a plugin component. A plugin carrying one
 * lists no such category in its inventory — which does print zero-count
 * categories — and reports `~0 tok` always-on. So this follows the exact shape
 * `statusline-writer.ts` already uses for the same reason (§17: `statusLine`
 * exists only in `settings.json`, with no plugin-manifest key): a wholly-owned
 * project artifact, plus an ADD-ONLY `settings.json` key.
 *
 * ⚠️ THE MECHANISM IS NOT YET PROBE-VERIFIED. §23.4 records that the
 * behavioural check — does a project-level style actually reach the model —
 * was attempted on 2026-08-11 and could not run, because the engine's OAuth
 * session had expired. No turn happened, so nothing was observed either way.
 * Re-run `node spikes/11-output-style.mjs --live` after logging in.
 *
 * Until that resolves, this is a file written into a project and a settings key
 * set add-only. If the engine ignores both, nothing breaks and nothing is
 * clobbered — but it also does nothing, and this comment is the honest record
 * of that rather than an implied guarantee.
 *
 * SINGLE SOURCE OF TRUTH FOR THE NUMBERS. Every limit below is interpolated
 * from `HUMAN_REPORT_LIMITS`, exactly as `./manager-protocol.ts` does, so the
 * style and the protocol block cannot state different budgets. A parity test
 * asserts they agree.
 */
import { DEFAULT_PRESENTATION_POLICY, PRESENTATION_GLYPH_ROLES, glyph } from "@crabgic/contracts";

/** The style's name, as the `outputStyle` settings value must spell it. */
export const OUTPUT_STYLE_NAME = "Crabgic";

const LIMITS = DEFAULT_PRESENTATION_POLICY.limits;

/** The glyph table, one role per line — the same vocabulary the protocol block renders. */
function renderGlyphs(): string {
  return PRESENTATION_GLYPH_ROLES.map((role) => `${glyph(role, "emoji")} ${role}`).join(" · ");
}

/**
 * The style file's content, frontmatter included.
 *
 * Deliberately SHORT. This is loaded into every turn in the project, so every
 * line costs tokens forever — the same discipline the manager protocol block's
 * line cap enforces. Rationale belongs in `docs/presentation-policy.md`, which
 * is loaded on demand; what is here is only the instruction.
 */
export function buildOutputStyle(): string {
  return `---
name: ${OUTPUT_STYLE_NAME}
description: Answer-first, signposted reporting for a reader with limited working memory.
---

Report so it can be read at a glance. The reader has a condition that makes long
unordered prose very hard to parse — this is an accessibility requirement, not a
style preference. An answer buried inside an undifferentiated block has not been
delivered.

**Structure.** Answer first, in ≤${String(LIMITS.leadAnswerMaxLines)} lines. Past ${String(LIMITS.headingRequiredAboveLines)} lines use \`##\` headings. Never
more than ${String(LIMITS.proseBlockMaxLines)} unbroken prose lines. Prefer bullets (≤${String(LIMITS.bulletMaxWords)} words, ≤${String(LIMITS.sectionMaxBullets)} per section)
over paragraphs, and once ${String(LIMITS.tableMinRows)}+ items each carry two or more attributes, use a
table.

**Volume.** No preamble, no recap, no closer. Park tangents as named follow-ups;
never widen the report to cover one. Carry progress across turns (\`step 3 of 5\`),
and end on the single next action that follows from it.

**Signposting.** Use these glyphs and no others — they are navigation aids, not
decoration:

${renderGlyphs()}

Carry contrast too: **bold** the verdict and the numbers that matter, and wrap
every identifier, path and command in \`code\`.

Stay brief unless asked for detail — and format the long answer too.

None of this reaches shared artifacts: PR, commit, Jira and Grafana text stays
neutral and emoji-free.
`;
}
