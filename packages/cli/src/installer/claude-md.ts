/**
 * `CLAUDE.md` managed-block content — roadmap/10-plugin-and-installer.md
 * §In scope: "`CLAUDE.md` managed block (`@AGENTS.md` import when the
 * target repo already has one, §3.4/§6.2)." Adaptation §6.2: when the
 * target repo already maintains an `AGENTS.md`, the managed block is just
 * the import line, never duplicated instruction text.
 */
import { GATEWAY_MCP_SERVER_NAME } from "@crabgic/contracts";
import { buildManagerProtocolBlock } from "@crabgic/plugin";
import { mergeManagedTextBlock, type TextMergeResult } from "./merge-text.js";

// Interpolated (never a hand-typed literal) so the Gap-11 sole-definition
// scanner stays green — the generated CLAUDE.md still shows the real server name.
const CAPABILITIES = `# Crabgic

This project is managed by the Crabgic plugin. The manager
session in this repo has access to:

- Slash commands: \`/eo:run\`, \`/eo:status\`, \`/eo:approve\`, \`/eo:evidence\`,
  \`/eo:connections\`, \`/eo:protocol\`.
- Read-only subagents: \`eo-explore\` (repository prior art), \`eo-researcher\`
  (research, the only agent with web access), \`eo-architect\` (design),
  \`eo-planner\` (tasks), \`eo-reviewer\` (review, one lens per round),
  \`eo-domain-reviewer\` (one domain lens per round — the design panel and the
  end-product audit), \`eo-documenter\` (user and maintenance guides), and
  \`eo-roaster\` (adversarial — one fresh instance per review round).
- The \`${GATEWAY_MCP_SERVER_NAME}\` MCP server (registered in this project's \`.mcp.json\`).

Run \`crabgic doctor\` to check installation health, or
\`crabgic upgrade\`/\`uninstall\` to manage this installation.`;

/**
 * Adaptation §6.2's bridge form: a single `@AGENTS.md` import line so a repo
 * that already maintains an `AGENTS.md` for other tooling has its own content
 * read exactly once, never duplicated into `CLAUDE.md`.
 */
export const AGENTS_MD_BRIDGE = "@AGENTS.md";

/**
 * The managed block: what the plugin gives this session, then how to operate.
 *
 * The operating protocol is NOT optional and NOT conditional. It is the only
 * delivery path Crabgic has for "be autonomous; here is when to stop; here is
 * how to ask" into a manager session, and a session that does not receive it
 * falls back to Claude Code's conversational default of checking in after
 * every step — which is precisely the defect this block exists to prevent.
 *
 * WHY THE BRIDGE IS NOW ADDITIVE (behavior change, 2026-07-27). This function
 * used to return the bare `@AGENTS.md` line when the target repo had an
 * `AGENTS.md`, dropping everything above. Adaptation §6.2's "one source of
 * truth per repo" argument is about not duplicating THE REPO'S OWN
 * instructions; Crabgic's protocol is not in any `AGENTS.md` and has no second
 * source to conflict with. Collapsing the block therefore bought no
 * de-duplication and cost the whole protocol — observed live as a manager
 * session with no autonomy instructions at all. The import line is kept
 * verbatim (so §6.2's actual mechanism is unchanged and the repo's content is
 * still read exactly once); it is now emitted alongside the block instead of
 * in place of it.
 */
export function buildClaudeMdManagedBlockContent(hasAgentsMd: boolean): string {
  const sections = [CAPABILITIES, buildManagerProtocolBlock()];
  if (hasAgentsMd) {
    sections.push(
      `## Project instructions\n\nThis repository maintains its own \`AGENTS.md\`; it is imported here rather\nthan copied, so it stays the single source of truth for project-specific\nguidance (adaptation §6.2).\n\n${AGENTS_MD_BRIDGE}`,
    );
  }
  return sections.join("\n\n");
}

/** Merges this installer's managed block into an existing (or absent) `CLAUDE.md`. */
export function mergeClaudeMd(
  existingContent: string | undefined,
  hasAgentsMd: boolean,
): TextMergeResult {
  return mergeManagedTextBlock(existingContent, buildClaudeMdManagedBlockContent(hasAgentsMd));
}
