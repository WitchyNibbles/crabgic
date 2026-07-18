import { compileEnvelope, type CompiledWorkerProfile } from "@eo/engine-core";
import { GATEWAY_MCP_SERVER_NAME, type AuthorizationEnvelope } from "@eo/contracts";
import { buildAuthorizationEnvelope } from "../../fixtures/authorization-envelope.js";
import {
  mergePermissionRuleSets,
  permissionProfileToRuleSet,
  type PermissionRuleSet,
} from "../permission-evaluator.js";
import { validateConformanceFixture, type ConformanceFixture } from "./schema.js";

/**
 * Initial envelope-conformance fixture set (roadmap/03-envelope-compiler-
 * engine-adapter.md work item 6: "compound-command and process-wrapper
 * smuggling, path escape (`../`, absolute), deny-wins (same-level and
 * cross-level), the blanket-`mcp__*`-deny footgun"). Each fixture's
 * `expected` verdicts are HAND-DERIVED here from docs/engine-baseline.md
 * (exit criterion 4: "every fixture ... produces its hand-derived expected
 * per-layer verdict") — see each fixture's own `description`/
 * `baselineCitation` for the derivation.
 *
 * `permissionOverride` replaces the compiled profile's own allow/deny
 * arrays outright (bypassing `@eo/engine-core`'s mandatory 4-literal/
 * mandatory-deny set) for the two smuggling fixtures and the deny-wins
 * fixtures — this isolates default-deny/deny-wins behavior using the same
 * minimal ruleset shape docs/engine-baseline.md §3's own live probes used
 * (`Bash(echo:*)` allow only, no curl-specific deny), for the closest
 * possible parity with the recorded probe setup (see `../parity.test.ts`).
 */

export function resolveConformanceFixture(fixture: ConformanceFixture): {
  readonly profile: CompiledWorkerProfile;
  readonly permissionRules: PermissionRuleSet;
} {
  const envelope = buildAuthorizationEnvelope(
    (fixture.envelopeOverrides ?? {}) as Partial<AuthorizationEnvelope>,
  );
  const baseProfile = compileEnvelope(envelope);
  const profile: CompiledWorkerProfile = fixture.permissionOverride
    ? {
        ...baseProfile,
        permissions: {
          ...baseProfile.permissions,
          allow: [...fixture.permissionOverride.allow],
          deny: [...fixture.permissionOverride.deny],
        },
      }
    : baseProfile;
  const permissionRules = mergePermissionRuleSets(
    permissionProfileToRuleSet(profile.permissions),
    ...(fixture.additionalPermissionLevels ?? []),
  );
  return { profile, permissionRules };
}

export const COMPOUND_COMMAND_SMUGGLING_FIXTURE: ConformanceFixture = validateConformanceFixture({
  name: "compound-command-smuggling",
  description:
    "echo x && curl http://example.com — the curl subcommand independently fails to match the " +
    "Bash(echo:*) allow rule (docs/engine-baseline.md §3 'permissions.compound-command-smuggling', " +
    "verdict PASS). Sandbox layer independently denies too: example.com is absent from " +
    "sandbox.network.allowedDomains — both layers catch this call for different reasons.",
  baselineCitation: "docs/engine-baseline.md §3, probe 'permissions.compound-command-smuggling'",
  permissionOverride: { allow: ["Bash(echo:*)"], deny: [] },
  toolCall: { toolName: "Bash", toolInput: { command: "echo x && curl http://example.com" } },
  expected: { permissions: "deny", adjudication: "allow", sandbox: "deny" },
});

export const PROCESS_WRAPPER_SMUGGLING_FIXTURE: ConformanceFixture = validateConformanceFixture({
  name: "process-wrapper-smuggling",
  description:
    "nohup curl http://example.com — the wrapper is stripped and curl still fails to match " +
    "Bash(echo:*) (docs/engine-baseline.md §3 'permissions.process-wrapper-smuggling', verdict PASS).",
  baselineCitation: "docs/engine-baseline.md §3, probe 'permissions.process-wrapper-smuggling'",
  permissionOverride: { allow: ["Bash(echo:*)"], deny: [] },
  toolCall: { toolName: "Bash", toolInput: { command: "nohup curl http://example.com" } },
  expected: { permissions: "deny", adjudication: "allow", sandbox: "deny" },
});

export const PATH_ESCAPE_RELATIVE_FIXTURE: ConformanceFixture = validateConformanceFixture({
  name: "path-escape-relative",
  description:
    "Edit targeting packages/example/src/../../../etc/passwd — the permission layer's anchored-glob " +
    "matcher normalizes the traversal and rejects it (no allow rule covers the escaped path). The " +
    "sandbox layer (scoped to denyRead only — allowWrite is placeholder-only in the compiled profile, " +
    "see ../../README.md's sandbox-layer-scope deviation) does NOT independently catch this, " +
    "demonstrating the layers are genuinely independent (roadmap/03 work item 6: 'each layer " +
    "independently assertable').",
  baselineCitation: "roadmap/03 work item 6 fixture list: 'path escape (../, absolute)'",
  envelopeOverrides: { ownedPaths: ["packages/example/src"] },
  toolCall: {
    toolName: "Edit",
    toolInput: { file_path: "packages/example/src/../../../etc/passwd" },
  },
  expected: { permissions: "deny", adjudication: "allow", sandbox: "allow" },
});

export const PATH_ESCAPE_ABSOLUTE_FIXTURE: ConformanceFixture = validateConformanceFixture({
  name: "path-escape-absolute",
  description:
    "Edit targeting the absolute path /etc/passwd against a '//'-anchored (worktree-relative) " +
    "owned-path rule — anchor mismatch, no allow rule matches. Sandbox layer allows (not a denyRead entry).",
  baselineCitation: "roadmap/03 work item 6 fixture list: 'path escape (../, absolute)'",
  envelopeOverrides: { ownedPaths: ["packages/example/src"] },
  toolCall: { toolName: "Edit", toolInput: { file_path: "/etc/passwd" } },
  expected: { permissions: "deny", adjudication: "allow", sandbox: "allow" },
});

export const DENY_WINS_SAME_LEVEL_FIXTURE: ConformanceFixture = validateConformanceFixture({
  name: "deny-wins-same-level",
  description:
    "Bash(echo:*) present in both allow and deny at the same (single, compiled) level — deny wins " +
    "(docs/engine-baseline.md §3 'permissions.deny-wins-same-level', verdict PASS).",
  baselineCitation: "docs/engine-baseline.md §3, probe 'permissions.deny-wins-same-level'",
  permissionOverride: { allow: ["Bash(echo:*)"], deny: ["Bash(echo:*)"] },
  toolCall: { toolName: "Bash", toolInput: { command: "echo same-level-test" } },
  expected: { permissions: "deny", adjudication: "allow", sandbox: "allow" },
});

export const DENY_WINS_CROSS_LEVEL_FIXTURE: ConformanceFixture = validateConformanceFixture({
  name: "deny-wins-cross-level",
  description:
    "A project-tier allow (Bash(echo:*)) merged with a user-tier deny for the identical rule — deny " +
    "wins across levels, via the same union-then-deny-wins mechanism as same-level (docs/engine-" +
    "baseline.md §3 'permissions.deny-wins-cross-level', verdict PASS: 'user-tier deny ... wins over " +
    "project-tier allow').",
  baselineCitation: "docs/engine-baseline.md §3, probe 'permissions.deny-wins-cross-level'",
  permissionOverride: { allow: ["Bash(echo:*)"], deny: [] },
  additionalPermissionLevels: [{ allow: [], deny: ["Bash(echo:*)"] }],
  toolCall: { toolName: "Bash", toolInput: { command: "echo cross-level-test" } },
  expected: { permissions: "deny", adjudication: "allow", sandbox: "allow" },
});

export const BLANKET_MCP_DENY_FOOTGUN_FIXTURE: ConformanceFixture = validateConformanceFixture({
  name: "blanket-mcp-deny-footgun",
  description:
    "A hand-broken profile with deny:['mcp__*'] shadowing the specific " +
    `mcp__${GATEWAY_MCP_SERVER_NAME}__* allow entry — the exact footgun adaptation Appendix B warns ` +
    "about, and @eo/engine-core's own assertNoBlanketMcpDeny invariant guards the REAL compiler " +
    "against ever emitting. This fixture proves the fake engine's evaluator still honors deny-wins " +
    "semantics if such a rule ever leaked in some other way.",
  baselineCitation:
    "adaptation Appendix B mcp__* deny footgun warning; @eo/engine-core src/footguns/invariants.ts",
  permissionOverride: { allow: [`mcp__${GATEWAY_MCP_SERVER_NAME}__*`], deny: ["mcp__*"] },
  toolCall: { toolName: `mcp__${GATEWAY_MCP_SERVER_NAME}__search`, toolInput: {} },
  expected: { permissions: "deny", adjudication: "allow", sandbox: "allow" },
});

export const CONFORMANCE_FIXTURES: readonly ConformanceFixture[] = [
  COMPOUND_COMMAND_SMUGGLING_FIXTURE,
  PROCESS_WRAPPER_SMUGGLING_FIXTURE,
  PATH_ESCAPE_RELATIVE_FIXTURE,
  PATH_ESCAPE_ABSOLUTE_FIXTURE,
  DENY_WINS_SAME_LEVEL_FIXTURE,
  DENY_WINS_CROSS_LEVEL_FIXTURE,
  BLANKET_MCP_DENY_FOOTGUN_FIXTURE,
];
