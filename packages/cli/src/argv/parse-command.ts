/**
 * `argv` → `ParsedCommand` — roadmap/09-cli-and-doctor.md work item 1:
 * "Parser + command skeletons for every declared command." Every command
 * this phase's plan names (§In scope "Commands" bullet) has a branch below;
 * `connection`/`trust`/`learn` each fan out into their own sub-verbs. Secret-
 * bearing flags (`connection add`'s credential reference) are validated
 * through `./secret-reference.ts` right here, at the parse boundary — never
 * deferred to a command handler that might log/forward the raw string
 * first.
 */
import { CliUsageError } from "../errors.js";
import { parseSecretReference } from "./secret-reference.js";
import { readBooleanFlag, readValueFlag, tokenize } from "./tokenize.js";
import type { ConnectionProvider, ParsedCommand } from "./types.js";

function requirePositional(positionals: readonly string[], index: number, label: string): string {
  const value = positionals[index];
  if (value === undefined) {
    throw new CliUsageError(`missing required argument: ${label}`);
  }
  return value;
}

function parseConnection(rest: readonly string[]): ParsedCommand {
  const [verb, ...remainder] = rest;
  if (verb === "add") {
    const t = tokenize(remainder, ["reference"]);
    const provider = requirePositional(t.positionals, 0, "provider (jira|grafana)");
    if (provider !== "jira" && provider !== "grafana") {
      throw new CliUsageError(`unknown connection provider "${provider}" (expected jira|grafana)`);
    }
    const rawReference = readValueFlag(t, "reference");
    if (rawReference === undefined) {
      throw new CliUsageError('"connection add" requires --reference <secret-reference>');
    }
    const reference = parseSecretReference("--reference", rawReference);
    return {
      command: "connection-add",
      provider: provider as ConnectionProvider,
      reference,
      json: readBooleanFlag(t, "json"),
    };
  }
  if (verb === "list") {
    const t = tokenize(remainder);
    return { command: "connection-list", json: readBooleanFlag(t, "json") };
  }
  if (verb === "doctor") {
    const t = tokenize(remainder);
    const connectionId = requirePositional(t.positionals, 0, "connection-id");
    return { command: "connection-doctor", connectionId, json: readBooleanFlag(t, "json") };
  }
  if (verb === "capabilities") {
    const t = tokenize(remainder);
    const connectionId = requirePositional(t.positionals, 0, "connection-id");
    return { command: "connection-capabilities", connectionId, json: readBooleanFlag(t, "json") };
  }
  throw new CliUsageError(
    `unknown "connection" sub-command "${verb ?? ""}" (expected add|list|doctor|capabilities)`,
  );
}

function parseTrust(rest: readonly string[]): ParsedCommand {
  const [verb, ...remainder] = rest;
  const t = tokenize(remainder);
  if (verb === "review") {
    return { command: "trust-review", json: readBooleanFlag(t, "json") };
  }
  if (verb === "approve") {
    const digest = requirePositional(t.positionals, 0, "digest");
    return { command: "trust-approve", digest, json: readBooleanFlag(t, "json") };
  }
  if (verb === "revoke") {
    const tokenId = requirePositional(t.positionals, 0, "token-id");
    return { command: "trust-revoke", tokenId, json: readBooleanFlag(t, "json") };
  }
  throw new CliUsageError(`unknown "trust" sub-command "${verb ?? ""}" (expected review|approve|revoke)`);
}

function parseLearn(rest: readonly string[]): ParsedCommand {
  const [verb, ...remainder] = rest;
  const t = tokenize(remainder);
  if (verb === "list") {
    return { command: "learn-list", json: readBooleanFlag(t, "json") };
  }
  if (verb === "approve") {
    const proposalId = requirePositional(t.positionals, 0, "proposal-id");
    return { command: "learn-approve", proposalId, json: readBooleanFlag(t, "json") };
  }
  if (verb === "reject") {
    const proposalId = requirePositional(t.positionals, 0, "proposal-id");
    return { command: "learn-reject", proposalId, json: readBooleanFlag(t, "json") };
  }
  if (verb === "rollback") {
    const proposalId = requirePositional(t.positionals, 0, "proposal-id");
    return { command: "learn-rollback", proposalId, json: readBooleanFlag(t, "json") };
  }
  throw new CliUsageError(
    `unknown "learn" sub-command "${verb ?? ""}" (expected list|approve|reject|rollback)`,
  );
}

/** Parses one full `argv` slice (i.e. `process.argv.slice(2)`) into a `ParsedCommand`. Throws `CliUsageError` for anything malformed — never returns a partial/undefined result. */
export function parseCommand(argv: readonly string[]): ParsedCommand {
  const [command, ...rest] = argv;

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    const t = tokenize(rest);
    return {
      command: "help",
      json: readBooleanFlag(t, "json"),
      ...(t.positionals[0] !== undefined ? { topic: t.positionals[0] } : {}),
    };
  }

  switch (command) {
    case "install": {
      const t = tokenize(rest);
      return {
        command: "install",
        dryRun: readBooleanFlag(t, "dry-run"),
        json: readBooleanFlag(t, "json"),
      };
    }
    case "doctor": {
      const t = tokenize(rest);
      return {
        command: "doctor",
        repairPlan: readBooleanFlag(t, "repair-plan"),
        json: readBooleanFlag(t, "json"),
      };
    }
    case "run": {
      const t = tokenize(rest);
      return { command: "run", json: readBooleanFlag(t, "json") };
    }
    case "status": {
      const t = tokenize(rest);
      return {
        command: "status",
        ...(t.positionals[0] !== undefined ? { runId: t.positionals[0] } : {}),
        watch: readBooleanFlag(t, "watch"),
        json: readBooleanFlag(t, "json"),
      };
    }
    case "resume": {
      const t = tokenize(rest);
      const runId = requirePositional(t.positionals, 0, "run-id");
      return { command: "resume", runId, json: readBooleanFlag(t, "json") };
    }
    case "cancel": {
      const t = tokenize(rest);
      const targetId = requirePositional(t.positionals, 0, "run-id|task-id");
      return { command: "cancel", targetId, json: readBooleanFlag(t, "json") };
    }
    case "evidence": {
      const t = tokenize(rest);
      const changeSetId = requirePositional(t.positionals, 0, "change-set-id");
      return { command: "evidence", changeSetId, json: readBooleanFlag(t, "json") };
    }
    case "connection":
      return parseConnection(rest);
    case "trust":
      return parseTrust(rest);
    case "learn":
      return parseLearn(rest);
    case "upgrade": {
      const t = tokenize(rest);
      return {
        command: "upgrade",
        dryRun: readBooleanFlag(t, "dry-run"),
        json: readBooleanFlag(t, "json"),
      };
    }
    case "uninstall": {
      const t = tokenize(rest);
      return {
        command: "uninstall",
        keepState: readBooleanFlag(t, "keep-state"),
        json: readBooleanFlag(t, "json"),
      };
    }
    case "gateway": {
      const [sub] = rest;
      if (sub !== "mcp") {
        throw new CliUsageError(`unknown "gateway" sub-command "${sub ?? ""}" (expected mcp)`);
      }
      return { command: "gateway-mcp" };
    }
    default:
      throw new CliUsageError(`unknown command "${command}"`);
  }
}
