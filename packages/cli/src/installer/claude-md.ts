/**
 * `CLAUDE.md` managed-block content — roadmap/10-plugin-and-installer.md
 * §In scope: "`CLAUDE.md` managed block (`@AGENTS.md` import when the
 * target repo already has one, §3.4/§6.2)." Adaptation §6.2: when the
 * target repo already maintains an `AGENTS.md`, the managed block is just
 * the import line, never duplicated instruction text.
 */
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { mergeManagedTextBlock, type TextMergeResult } from "./merge-text.js";

// Interpolated (never a hand-typed literal) so the Gap-11 sole-definition
// scanner stays green — the generated CLAUDE.md still shows the real server name.
const FULL_INSTRUCTIONS = `# Engineering Orchestrator

This project is managed by the Engineering Orchestrator plugin. The manager
session in this repo has access to:

- Slash commands: \`/eo:run\`, \`/eo:status\`, \`/eo:approve\`, \`/eo:evidence\`,
  \`/eo:connections\`.
- Read-heavy exploration/review subagents: \`eo-explore\`, \`eo-reviewer\`.
- The \`${GATEWAY_MCP_SERVER_NAME}\` MCP server (registered in this project's \`.mcp.json\`).

Run \`engineering-orchestrator doctor\` to check installation health, or
\`engineering-orchestrator upgrade\`/\`uninstall\` to manage this installation.`;

/** Adaptation §6.2's exact bridge form: a single \`@AGENTS.md\` import line, never duplicated content, when the target repo already maintains its own \`AGENTS.md\`. */
const AGENTS_MD_BRIDGE = "@AGENTS.md";

export function buildClaudeMdManagedBlockContent(hasAgentsMd: boolean): string {
  return hasAgentsMd ? AGENTS_MD_BRIDGE : FULL_INSTRUCTIONS;
}

/** Merges this installer's managed block into an existing (or absent) `CLAUDE.md`. */
export function mergeClaudeMd(
  existingContent: string | undefined,
  hasAgentsMd: boolean,
): TextMergeResult {
  return mergeManagedTextBlock(existingContent, buildClaudeMdManagedBlockContent(hasAgentsMd));
}
