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
import { readBooleanFlag, readValueFlag, tokenize, type Tokenized } from "./tokenize.js";
import type { ConnectionProvider, ParsedCommand } from "./types.js";

function requirePositional(positionals: readonly string[], index: number, label: string): string {
  const value = positionals[index];
  if (value === undefined) {
    throw new CliUsageError(`missing required argument: ${label}`);
  }
  return value;
}

/** 16's `CapabilitySnapshot` cache default (15 minutes), used when `connection add` names no explicit `--discovery-ttl`. */
const DEFAULT_DISCOVERY_TTL_SECONDS = 15 * 60;

/** Rejects a non-https base URL at the PARSE boundary, so a downgraded origin never reaches the SSRF-guarded HTTP client (`ExternalConnectionSchema` refuses it too — this just fails earlier, with a usage error rather than a schema dump). */
function parseHttpsUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CliUsageError(`flag "--base-url" is not a valid URL: "${raw}"`);
  }
  if (parsed.protocol !== "https:") {
    throw new CliUsageError(`flag "--base-url" must use https:// (got "${parsed.protocol}//")`);
  }
  return raw;
}

/**
 * Comma-separated list flag. `./tokenize.ts`'s flag map is last-wins and
 * carries no repeatable-flag support; widening that well-tested phase-09
 * primitive for these three flags alone is not worth the blast radius, so
 * the list flags take `--allow-resource=a,b,c` instead.
 */
function parseCsvFlag(tokenized: Tokenized, name: string): readonly string[] | undefined {
  const raw = readValueFlag(tokenized, name);
  if (raw === undefined) return undefined;
  const items = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (items.length === 0) {
    throw new CliUsageError(`flag "--${name}" was supplied with no non-empty values`);
  }
  return items;
}

function parsePositiveIntFlag(tokenized: Tokenized, name: string): number | undefined {
  const raw = readValueFlag(tokenized, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new CliUsageError(`flag "--${name}" must be a positive integer (got "${raw}")`);
  }
  return value;
}

function parseConnection(rest: readonly string[]): ParsedCommand {
  const [verb, ...remainder] = rest;
  if (verb === "add") {
    const t = tokenize(remainder, [
      "reference",
      "base-url",
      "deployment",
      "allow-redirect",
      "allow-resource",
      "allow-action",
      "discovery-ttl",
      "auth-mode",
      "username-ref",
      "client-id-ref",
    ]);
    const provider = requirePositional(t.positionals, 0, "provider (jira|grafana)");
    if (provider !== "jira" && provider !== "grafana") {
      throw new CliUsageError(`unknown connection provider "${provider}" (expected jira|grafana)`);
    }
    const rawReference = readValueFlag(t, "reference");
    if (rawReference === undefined) {
      throw new CliUsageError('"connection add" requires --reference <secret-reference>');
    }
    const reference = parseSecretReference("--reference", rawReference);

    const rawBaseUrl = readValueFlag(t, "base-url");
    if (rawBaseUrl === undefined) {
      throw new CliUsageError('"connection add" requires --base-url <https-url>');
    }
    const baseUrl = parseHttpsUrl(rawBaseUrl);
    const deploymentType = readValueFlag(t, "deployment");

    // The second half of a credential, when the chosen mode needs one.
    // Parsed through the same reference grammar as `--reference` so a
    // username or client id cannot be smuggled in as a literal.
    const rawUsernameRef = readValueFlag(t, "username-ref");
    const rawClientIdRef = readValueFlag(t, "client-id-ref");
    const authMode = readValueFlag(t, "auth-mode");

    return {
      command: "connection-add",
      provider: provider as ConnectionProvider,
      reference,
      baseUrl,
      ...(deploymentType !== undefined ? { deploymentType } : {}),
      ...(authMode !== undefined ? { authMode } : {}),
      ...(rawUsernameRef !== undefined
        ? { usernameReference: parseSecretReference("--username-ref", rawUsernameRef) }
        : {}),
      ...(rawClientIdRef !== undefined
        ? { clientIdReference: parseSecretReference("--client-id-ref", rawClientIdRef) }
        : {}),
      allowBasicAuth: readBooleanFlag(t, "allow-basic-auth"),
      // Defaults to the base URL's OWN origin: a connection that never
      // redirects off its own host is the safe default, and widening it is
      // an explicit operator act (roadmap/16's SSRF-guard allowlist).
      allowedRedirectOrigins: parseCsvFlag(t, "allow-redirect") ?? [new URL(baseUrl).origin],
      allowedResources: parseCsvFlag(t, "allow-resource") ?? [],
      allowedActions: parseCsvFlag(t, "allow-action") ?? [],
      discoveryTtlSeconds:
        parsePositiveIntFlag(t, "discovery-ttl") ?? DEFAULT_DISCOVERY_TTL_SECONDS,
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
  throw new CliUsageError(
    `unknown "trust" sub-command "${verb ?? ""}" (expected review|approve|revoke)`,
  );
}

/**
 * `design approve|reject|mint <change-set-id> --revision <rev> [--reason <why>]`.
 *
 * `mint` (owner ruling 2026-08-19, amending R2) produces an approval token the
 * gateway later verifies, so the design verdict becomes a journaled
 * `approval_token_mint` claimed once through the durable ledger rather than a
 * bare file write. It takes the same arguments as `approve` because the token is
 * bound to exactly that `(change set, revision)` pair.
 *
 * `--revision` is required on BOTH verbs rather than only on approve. An
 * approval that does not name what it approved carries forward across an edit,
 * and a rejection that does not name what it rejected leaves the design stage
 * unable to tell whether it has already been answered.
 */
function parseDesign(rest: readonly string[]): ParsedCommand {
  const [verb, ...remainder] = rest;
  // Both flags take a value, so they must be declared here: an undeclared
  // `--revision sha256:abc` tokenizes as a valueless flag plus a stray
  // positional, and the positional would silently become the change-set id.
  const t = tokenize(remainder, ["revision", "reason"]);
  if (verb !== "approve" && verb !== "reject" && verb !== "mint") {
    throw new CliUsageError(
      `unknown "design" sub-command "${verb ?? ""}" (expected approve|reject|mint)`,
    );
  }
  const changeSetId = requirePositional(t.positionals, 0, "change-set-id");
  const revision = readValueFlag(t, "revision");
  if (revision === undefined || revision.length === 0) {
    throw new CliUsageError('"design" requires --revision <design-revision>');
  }
  const reason = readValueFlag(t, "reason");
  if (verb === "reject" && (reason === undefined || reason.length === 0)) {
    // Refused HERE as well as by the schema, so the operator is told at the
    // point of typing rather than by a rejected write. The design stage loops
    // on this reason; without it the next round has nothing to change.
    throw new CliUsageError('"design reject" requires --reason <why>');
  }
  /**
   * `mint` shares every argument with `approve` — and must, because the token it
   * produces is bound to exactly this `(change set, revision)` pair. A mint that
   * accepted looser arguments than the approval it authorises would be minting
   * for a subject the gate cannot check.
   */
  const command =
    verb === "approve" ? "design-approve" : verb === "reject" ? "design-reject" : "design-mint";
  return {
    command,
    changeSetId,
    revision,
    ...(reason !== undefined ? { reason } : {}),
    json: readBooleanFlag(t, "json"),
  };
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
    case "approve": {
      const t = tokenize(rest);
      const digest = requirePositional(t.positionals, 0, "envelope-digest");
      return { command: "approve", digest, json: readBooleanFlag(t, "json") };
    }
    case "connection":
      return parseConnection(rest);
    case "trust":
      return parseTrust(rest);
    case "design":
      return parseDesign(rest);
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
