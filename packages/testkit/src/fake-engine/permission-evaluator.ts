import type { PermissionProfile } from "@eo/engine-core";
import {
  containsUnprovenShellMetacharacter,
  decomposeBashCommand,
  matchesBashPrefixRule,
} from "./bash-command-matching.js";
import { matchesToolPathRule } from "./path-matching.js";
import type { FakeToolCall } from "./tool-call.js";

/**
 * Layer 2 (permissions) — roadmap/03-envelope-compiler-engine-adapter.md
 * §In scope "Fake engine" bullet: "a permission-rule evaluator (allow/deny
 * matching over the profile's allow+deny entries — Bash prefix literal
 * matching with the no-space-colon form, Edit/Write path matching over
 * //-anchored globs, mcp__ tool names, deny-wins over allow at and across
 * levels, compound-command and process-wrapper smuggling detection)
 * asserting exactly the baseline-recorded verdicts."
 */
export interface PermissionRuleSet {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

/** Unions allow/deny across every ruleset given — the mechanism behind "deny wins ... across levels" (docs/engine-baseline.md §3). */
export function mergePermissionRuleSets(...sets: readonly PermissionRuleSet[]): PermissionRuleSet {
  return {
    allow: sets.flatMap((set) => set.allow),
    deny: sets.flatMap((set) => set.deny),
  };
}

export function permissionProfileToRuleSet(
  profile: Pick<PermissionProfile, "allow" | "deny">,
): PermissionRuleSet {
  return { allow: profile.allow, deny: profile.deny };
}

/**
 * The `Agent` rule name aliases the live `Task` tool literal
 * (docs/engine-baseline.md §4.1: "the `Agent` rule name maps to the
 * `Task` tool literal"; deny enforcement is catalog-removal, simulated
 * here as an ordinary deny match against the `Task` call name).
 */
const TOOL_NAME_ALIASES: Readonly<Record<string, string>> = { Agent: "Task", Task: "Agent" };

function toolNameRuleMatches(rule: string, toolName: string): boolean {
  return rule === toolName || TOOL_NAME_ALIASES[rule] === toolName;
}

const MCP_SCOPED_RULE_PATTERN = /^mcp__(.+)__\*$/;

/** Only ever called once the caller has confirmed `toolName` starts with `mcp__` (see `evaluatePermissionLayer`). */
function mcpRuleMatches(rule: string, toolName: string): boolean {
  if (rule === "mcp__*") {
    return true;
  }
  const match = MCP_SCOPED_RULE_PATTERN.exec(rule);
  const server = match?.[1];
  return server !== undefined && toolName.startsWith(`mcp__${server}__`);
}

function bashCommandOf(call: FakeToolCall): string {
  return typeof call.toolInput.command === "string" ? call.toolInput.command : "";
}

function pathOf(call: FakeToolCall): string {
  return typeof call.toolInput.file_path === "string" ? call.toolInput.file_path : "";
}

/**
 * Every decomposed subcommand must independently match at least one rule —
 * a single unmatched subcommand denies the whole compound command. MAJOR 2
 * fix: a subcommand still carrying an unproven shell metacharacter (see
 * `containsUnprovenShellMetacharacter`'s doc comment) denies the whole
 * command outright, even if it also happens to match an allowed prefix
 * lexically — the oracle fails closed on anything the baseline never
 * probed.
 */
function bashCommandMatchesEveryRule(rules: readonly string[], command: string): boolean {
  const segments = decomposeBashCommand(command);
  if (segments.length === 0) {
    return false;
  }
  if (segments.some((segment) => containsUnprovenShellMetacharacter(segment))) {
    return false;
  }
  return segments.every((segment) => rules.some((rule) => matchesBashPrefixRule(rule, segment)));
}

/** Any single decomposed subcommand matching a deny rule denies the whole compound command (deny wins). */
function bashCommandMatchesAnyRule(rules: readonly string[], command: string): boolean {
  return decomposeBashCommand(command).some((segment) =>
    rules.some((rule) => matchesBashPrefixRule(rule, segment)),
  );
}

export function evaluatePermissionLayer(
  rules: PermissionRuleSet,
  call: FakeToolCall,
): "allow" | "deny" {
  if (call.toolName === "Bash") {
    const command = bashCommandOf(call);
    if (bashCommandMatchesAnyRule(rules.deny, command)) {
      return "deny";
    }
    return bashCommandMatchesEveryRule(rules.allow, command) ? "allow" : "deny";
  }

  if (call.toolName === "Edit" || call.toolName === "Write" || call.toolName === "Read") {
    const path = pathOf(call);
    if (
      rules.deny.some((rule) =>
        matchesToolPathRule(rule, call.toolName as "Edit" | "Write" | "Read", path),
      )
    ) {
      return "deny";
    }
    return rules.allow.some((rule) =>
      matchesToolPathRule(rule, call.toolName as "Edit" | "Write" | "Read", path),
    )
      ? "allow"
      : "deny";
  }

  if (call.toolName.startsWith("mcp__")) {
    if (rules.deny.some((rule) => mcpRuleMatches(rule, call.toolName))) {
      return "deny";
    }
    return rules.allow.some((rule) => mcpRuleMatches(rule, call.toolName)) ? "allow" : "deny";
  }

  if (rules.deny.some((rule) => toolNameRuleMatches(rule, call.toolName))) {
    return "deny";
  }
  return rules.allow.some((rule) => toolNameRuleMatches(rule, call.toolName)) ? "allow" : "deny";
}
