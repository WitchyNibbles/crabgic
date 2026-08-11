/**
 * Help text — roadmap/09-cli-and-doctor.md §Interfaces produced item 8:
 * "Help text + JSON output schemas, snapshot-tested across every command
 * including `gateway mcp`." This is a plain data table (`COMMAND_HELP`)
 * rather than generated from the parser, so its snapshot is stable and
 * legible independent of `../argv/parse-command.ts`'s own internals.
 */
import { EXIT_OK } from "../exit-codes.js";
import { formatJson, type CommandResult } from "../output/format.js";
import { renderHumanReport } from "../output/human.js";
import { CLI_TEXT, pluralize } from "../output/reports.js";
import type { HelpCommand } from "../argv/types.js";

export const BINARY_NAME = "crabgic";

export interface CommandHelpEntry {
  readonly usage: string;
  /**
   * One short line, shown in the grouped top-level table.
   *
   * Held to a line an eye crosses in one fixation. Anything that needs a
   * caveat, a warning or a "this is the escalation path for…" goes in
   * `detail`, which only `help <command>` prints — a qualification nobody has
   * chosen the command yet cannot help them choose it.
   */
  readonly summary: string;
  /** Optional qualification, shown only by `help <command>`. */
  readonly detail?: string;
}

/** One entry per command name declared in the plan (roadmap/09 §In scope) — alphabetical by command name, `gateway mcp` included per its own explicit callout. */
export const COMMAND_HELP: Readonly<Record<string, CommandHelpEntry>> = {
  install: {
    usage: `${BINARY_NAME} install [--dry-run] [--json]`,
    summary: "Install the plugin/managed config into this project.",
  },
  doctor: {
    usage: `${BINARY_NAME} doctor [--repair-plan] [--json]`,
    summary: "Validate the host end-to-end against seeded fault checks.",
  },
  run: { usage: `${BINARY_NAME} run [--json]`, summary: "Dispatch a new run." },
  status: {
    usage: `${BINARY_NAME} status [run-id] [--watch] [--json]`,
    summary: "Show (or stream) a run's status.",
  },
  resume: {
    usage: `${BINARY_NAME} resume <run-id>`,
    summary: "Resume a parked or interrupted run.",
  },
  cancel: {
    usage: `${BINARY_NAME} cancel <run-id|task-id>`,
    summary: "Cancel a run or a single task within it.",
  },
  evidence: {
    usage: `${BINARY_NAME} evidence <change-set-id>`,
    summary: "Show every EvidenceRecord journaled for a ChangeSet.",
  },
  approve: {
    usage: `${BINARY_NAME} approve <envelope-digest> [--json]`,
    summary: "Approve a pending authorization envelope at an interactive terminal.",
    detail: "Human-only; the escalation path for out-of-policy work.",
  },
  connection: {
    usage: `${BINARY_NAME} connection add jira|grafana --base-url <https-url> --reference <secret-ref> [--deployment <type>] [--allow-redirect <csv>] [--allow-resource <csv>] [--allow-action <csv>] [--discovery-ttl <seconds>] / list / doctor <id> / capabilities <id>`,
    summary: "Manage external connector connections.",
  },
  trust: {
    usage: `${BINARY_NAME} trust review|approve|revoke`,
    summary: "Review and approve high-impact capability grants.",
  },
  learn: {
    usage: `${BINARY_NAME} learn list|approve|reject|rollback`,
    summary: "Manage reviewed learning proposals.",
  },
  upgrade: {
    usage: `${BINARY_NAME} upgrade [--dry-run]`,
    summary: "Upgrade the installed plugin/managed config.",
  },
  uninstall: {
    usage: `${BINARY_NAME} uninstall [--keep-state]`,
    summary: "Remove the installed plugin/managed config.",
  },
  gateway: {
    usage: `${BINARY_NAME} gateway mcp`,
    summary: "Boot the gateway MCP server over stdio (no user-facing flags).",
  },
};

/**
 * Top-level help, grouped by what the operator is trying to DO.
 *
 * WHAT THIS REPLACED. Fourteen commands, each contributing a full usage string
 * plus an indented summary — twenty-nine lines, in registration order, with no
 * grouping. `connection`'s usage line alone ran past two hundred characters and
 * wrapped into a paragraph of flags in any normal terminal, which is a
 * horizontal wall on the one screen a new operator reads first.
 *
 * The usage strings are not lost, they have MOVED: `crabgic help <command>`
 * still prints the full one, and `--json` still carries every field untouched.
 * What the top level answers is "which command do I want?", and a name plus a
 * one-line summary answers that; the flags answer a different question, asked
 * later, about a command already chosen.
 *
 * The grouping is by task rather than alphabetical because alphabetical order
 * is only useful to a reader who already knows the name — exactly the reader
 * who does not need this screen.
 */
const COMMAND_GROUPS: readonly { readonly title: string; readonly commands: readonly string[] }[] =
  [
    { title: "Setup", commands: ["install", "upgrade", "uninstall", "doctor"] },
    { title: "Runs", commands: ["run", "status", "resume", "cancel", "evidence"] },
    { title: "Approvals", commands: ["approve", "trust", "learn"] },
    { title: "Connectors", commands: ["connection", "gateway"] },
  ];

function renderTopLevelHelp(): string {
  const grouped = new Set(COMMAND_GROUPS.flatMap((group) => group.commands));
  // A command added to COMMAND_HELP but forgotten in COMMAND_GROUPS must still
  // be reachable. Falling through to "Other" keeps the omission visible and
  // harmless; dropping it would make `help` quietly lie about what exists, and
  // this module's own test asserts every command appears exactly once.
  const ungrouped = Object.keys(COMMAND_HELP).filter((name) => !grouped.has(name));
  const groups = [
    ...COMMAND_GROUPS,
    ...(ungrouped.length > 0 ? [{ title: "Other", commands: ungrouped }] : []),
  ];

  return renderHumanReport(
    {
      lead: `${pluralize(Object.keys(COMMAND_HELP).length, "command")}. \`${BINARY_NAME} help <command>\` for usage and flags.`,
      sections: groups.map((group) => ({
        title: group.title,
        rows: group.commands
          .filter((name) => COMMAND_HELP[name] !== undefined)
          .map((name) => ({ key: name, value: COMMAND_HELP[name]!.summary })),
      })),
    },
    CLI_TEXT,
  );
}

export function renderHelp(command: HelpCommand): CommandResult {
  if (command.topic !== undefined) {
    const entry = COMMAND_HELP[command.topic];
    const stdout =
      entry === undefined
        ? `no help available for "${command.topic}"\n`
        : `${entry.usage}\n    ${entry.summary}\n${
            entry.detail !== undefined ? `    ${entry.detail}\n` : ""
          }`;
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
