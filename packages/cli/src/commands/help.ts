/**
 * Help text — roadmap/09-cli-and-doctor.md §Interfaces produced item 8:
 * "Help text + JSON output schemas, snapshot-tested across every command
 * including `gateway mcp`." This is a plain data table (`COMMAND_HELP`)
 * rather than generated from the parser, so its snapshot is stable and
 * legible independent of `../argv/parse-command.ts`'s own internals.
 */
import { EXIT_OK } from "../exit-codes.js";
import { formatJson, type CommandResult } from "../output/format.js";
import type { HelpCommand } from "../argv/types.js";

export const BINARY_NAME = "engineering-orchestrator";

export interface CommandHelpEntry {
  readonly usage: string;
  readonly summary: string;
}

/** One entry per command name declared in the plan (roadmap/09 §In scope) — alphabetical by command name, `gateway mcp` included per its own explicit callout. */
export const COMMAND_HELP: Readonly<Record<string, CommandHelpEntry>> = {
  install: { usage: `${BINARY_NAME} install [--dry-run] [--json]`, summary: "Install the plugin/managed config into this project." },
  doctor: { usage: `${BINARY_NAME} doctor [--repair-plan] [--json]`, summary: "Validate the host end-to-end against seeded fault checks." },
  run: { usage: `${BINARY_NAME} run [--json]`, summary: "Dispatch a new run." },
  status: { usage: `${BINARY_NAME} status [run-id] [--watch] [--json]`, summary: "Show (or stream) a run's status." },
  resume: { usage: `${BINARY_NAME} resume <run-id>`, summary: "Resume a parked or interrupted run." },
  cancel: { usage: `${BINARY_NAME} cancel <run-id|task-id>`, summary: "Cancel a run or a single task within it." },
  evidence: { usage: `${BINARY_NAME} evidence <change-set-id>`, summary: "Show every EvidenceRecord journaled for a ChangeSet." },
  connection: { usage: `${BINARY_NAME} connection add jira|grafana / list / doctor <id> / capabilities <id>`, summary: "Manage external connector connections." },
  trust: { usage: `${BINARY_NAME} trust review|approve|revoke`, summary: "Review and approve high-impact capability grants." },
  learn: { usage: `${BINARY_NAME} learn list|approve|reject|rollback`, summary: "Manage reviewed learning proposals." },
  upgrade: { usage: `${BINARY_NAME} upgrade [--dry-run]`, summary: "Upgrade the installed plugin/managed config." },
  uninstall: { usage: `${BINARY_NAME} uninstall [--keep-state]`, summary: "Remove the installed plugin/managed config." },
  gateway: { usage: `${BINARY_NAME} gateway mcp`, summary: "Boot the gateway MCP server over stdio (no user-facing flags)." },
};

function renderTopLevelHelp(): string {
  const lines = ["Commands:", ""];
  for (const entry of Object.values(COMMAND_HELP)) {
    lines.push(`  ${entry.usage}`);
    lines.push(`      ${entry.summary}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderHelp(command: HelpCommand): CommandResult {
  if (command.topic !== undefined) {
    const entry = COMMAND_HELP[command.topic];
    const stdout = entry === undefined
      ? `no help available for "${command.topic}"\n`
      : `${entry.usage}\n    ${entry.summary}\n`;
    return {
      exitCode: EXIT_OK,
      stdout: command.json ? formatJson(entry ?? null) : stdout,
    };
  }
  return {
    exitCode: EXIT_OK,
    stdout: command.json ? formatJson(COMMAND_HELP) : renderTopLevelHelp(),
  };
}
