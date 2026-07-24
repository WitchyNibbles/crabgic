/**
 * The checked-in allowlist of known-deferred stubs — roadmap/23-release-
 * hardening.md work item 7: "assert the COUNT against a documented,
 * checked-in allowlist of known-deferred stubs (so a NEW unlisted
 * `NOT_IMPLEMENTED` fails the test, but the known-deferred ones are visible
 * and tracked)."
 *
 * Every entry here was discovered by actually loading/running
 * `packages/cli` + `packages/gateway` (see `./cliNotImplementedSweep.ts`
 * and `./gatewayFamilyCompleteness.ts`'s own file-level doc comments for
 * the full investigation trail) — this file is the audit trail, not a
 * guess. `./notImplementedSweepGate.ts`'s test asserts the REAL, live
 * sweep result is an EXACT set match against this list: adding a genuinely
 * new deferral requires a deliberate edit here (visible in review); a
 * brand-new, undocumented gap fails closed.
 */

export type KnownDeferredKind = "cli-command" | "gateway-family" | "gateway-protocol";

export interface KnownDeferredEntry {
  /** Stable slug — `cli.<command>` or `gateway.<family>` or `gateway.protocol.<method>`. */
  readonly id: string;
  readonly kind: KnownDeferredKind;
  /** File(s) where the gap lives, relative to the repo root. */
  readonly location: readonly string[];
  /** The roadmap phase that owns wiring the real backend/registration into production — "none (dead branch)" for the one structurally-unreachable entry. */
  readonly ownerPhase: string;
  readonly description: string;
}

export const KNOWN_DEFERRED_CLI_COMMANDS: readonly KnownDeferredEntry[] = [
  {
    id: "cli.resume",
    kind: "cli-command",
    location: ["packages/cli/src/commands/dispatch.ts"],
    ownerPhase:
      "06/13 (session-resume + parked-work-unit re-dispatch semantics; CLI wiring itself unowned)",
    description:
      '"resume <run-id>" has no backend at all — no CliDependencies field, no conditional branch.',
  },
  {
    id: "cli.connection-add",
    kind: "cli-command",
    location: ["packages/cli/src/commands/dispatch.ts"],
    ownerPhase:
      "18/19/20 (connector connection lifecycle) + 09/23 (CLI wiring, per those phases' own text)",
    description: '"connection-add" has no backend wired.',
  },
  {
    id: "cli.connection-list",
    kind: "cli-command",
    location: ["packages/cli/src/commands/dispatch.ts"],
    ownerPhase: "18/19/20 + 09/23",
    description: '"connection-list" has no backend wired.',
  },
  {
    id: "cli.connection-doctor",
    kind: "cli-command",
    location: ["packages/cli/src/commands/dispatch.ts"],
    ownerPhase: "18/19/20 + 09/23",
    description:
      '"connection-doctor" has no backend wired — 18/19/20 each built their own connection-doctor probe function, but CLI invocation is explicitly deferred per those phases’ own text ("CLI invocation of this check is 09/23’s wiring concern, not asserted here").',
  },
  {
    id: "cli.connection-capabilities",
    kind: "cli-command",
    location: ["packages/cli/src/commands/dispatch.ts"],
    ownerPhase: "18/19/20 + 09/23",
    description: '"connection-capabilities" has no backend wired.',
  },
  {
    id: "cli.trust-review",
    kind: "cli-command",
    location: [
      "packages/cli/src/commands/dispatch.ts",
      "packages/detect/src/trust/trust-review.ts",
    ],
    ownerPhase: "12",
    description:
      "A REAL backend exists (packages/detect/src/trust/trust-review.ts’s runTrustReviewCommand) but " +
      "packages/cli/src/commands/dispatch.ts never imports it — CliDependencies has no trust field at " +
      "all, unlike installer/intake/learning’s established optional-dependency pattern.",
  },
  {
    id: "cli.trust-approve",
    kind: "cli-command",
    location: [
      "packages/cli/src/commands/dispatch.ts",
      "packages/detect/src/trust/trust-approve.ts",
    ],
    ownerPhase: "12",
    description: "Same unwired-despite-built gap as cli.trust-review, for trust-approve.",
  },
  {
    id: "cli.trust-revoke",
    kind: "cli-command",
    location: [
      "packages/cli/src/commands/dispatch.ts",
      "packages/detect/src/trust/trust-revoke.ts",
    ],
    ownerPhase: "12",
    description: "Same unwired-despite-built gap as cli.trust-review, for trust-revoke.",
  },
  {
    id: "cli.run",
    kind: "cli-command",
    location: ["packages/cli/src/bootstrap.ts", "packages/cli/src/commands/real-handlers.ts"],
    ownerPhase: "11",
    description:
      "A REAL backend exists (runIntakeCommand) and dispatch.ts’s conditional branch is real, but " +
      "packages/cli/src/bootstrap.ts’s buildRealCliDependencies() never supplies deps.intake — " +
      '"run" is unconditionally NOT_IMPLEMENTED in the real, shipped binary today, despite that ' +
      "type’s own doc comment claiming bootstrap.ts supplies it.",
  },
  {
    id: "cli.learn-list",
    kind: "cli-command",
    location: [
      "packages/cli/src/bootstrap.ts",
      "packages/cli/src/learning/learn-command-backend.ts",
    ],
    ownerPhase: "22",
    description:
      "Same unwired-despite-built gap as cli.run: buildRealCliDependencies() never supplies " +
      "deps.learning.",
  },
  {
    id: "cli.learn-approve",
    kind: "cli-command",
    location: [
      "packages/cli/src/bootstrap.ts",
      "packages/cli/src/learning/learn-command-backend.ts",
    ],
    ownerPhase: "22",
    description: "Same unwired-despite-built gap as cli.learn-list, for learn-approve.",
  },
  {
    id: "cli.learn-reject",
    kind: "cli-command",
    location: [
      "packages/cli/src/bootstrap.ts",
      "packages/cli/src/learning/learn-command-backend.ts",
    ],
    ownerPhase: "22",
    description: "Same unwired-despite-built gap as cli.learn-list, for learn-reject.",
  },
  {
    id: "cli.learn-rollback",
    kind: "cli-command",
    location: [
      "packages/cli/src/bootstrap.ts",
      "packages/cli/src/learning/learn-command-backend.ts",
    ],
    ownerPhase: "22",
    description: "Same unwired-despite-built gap as cli.learn-list, for learn-rollback.",
  },
  {
    id: "cli.status-all-runs",
    kind: "cli-command",
    location: ["packages/cli/src/commands/real-handlers.ts"],
    ownerPhase: "05",
    description:
      '"status" with no run-id (list every run) has no backing UDS operation yet — 05’s router ' +
      "has no registry.runs.list; a specific run-id is fully wired via run.status.",
  },
  {
    id: "cli.gateway-mcp-dead-branch",
    kind: "cli-command",
    location: ["packages/cli/src/commands/dispatch.ts"],
    ownerPhase: "none (dead branch, not a real gap)",
    description:
      'dispatch.ts has a "gateway-mcp" case returning NOT_IMPLEMENTED, but cli-entry.ts intercepts ' +
      "that command before ever calling dispatchCommand for it in the real binary — structurally " +
      "unreachable, kept only so the CommandName union stays exhaustively handled.",
  },
];

export const KNOWN_DEFERRED_GATEWAY_FAMILIES: readonly KnownDeferredEntry[] = [
  {
    id: "gateway.tracker",
    kind: "gateway-family",
    location: [
      "packages/cli/src/cli-entry.ts",
      "packages/gateway/src/mcp/native-tools/tracker-tools.ts",
    ],
    ownerPhase: "16",
    description:
      "buildTrackerTools exists in packages/gateway but packages/cli/src/cli-entry.ts’s " +
      "defaultRunGatewayMcp (the real gateway-mcp boot path) never registers it — packages/cli has " +
      "zero dependency edge on @eo/gateway at all.",
  },
  {
    id: "gateway.observability",
    kind: "gateway-family",
    location: [
      "packages/cli/src/cli-entry.ts",
      "packages/gateway/src/mcp/native-tools/observability-tools.ts",
    ],
    ownerPhase: "16",
    description:
      "Same unwired-at-production-entrypoint gap as gateway.tracker, for observability.*.",
  },
  {
    id: "gateway.evidence",
    kind: "gateway-family",
    location: [
      "packages/cli/src/cli-entry.ts",
      "packages/gateway/src/mcp/native-tools/evidence-tools.ts",
    ],
    ownerPhase: "16",
    description:
      "Same unwired-at-production-entrypoint gap as gateway.tracker, for evidence.get/evidence.attach.",
  },
  {
    id: "gateway.result",
    kind: "gateway-family",
    location: [
      "packages/cli/src/cli-entry.ts",
      "packages/gateway/src/mcp/native-tools/result-tools.ts",
    ],
    ownerPhase: "16",
    description: "Same unwired-at-production-entrypoint gap as gateway.tracker, for result.submit.",
  },
  {
    id: "gateway.run-forward",
    kind: "gateway-family",
    location: [
      "packages/cli/src/cli-entry.ts",
      "packages/gateway/src/mcp/native-tools/run-forward-tools.ts",
    ],
    ownerPhase: "16",
    description:
      "Same unwired-at-production-entrypoint gap as gateway.tracker, for forwarded " +
      "run.status/run.cancel.",
  },
  {
    id: "gateway.project-inspect",
    kind: "gateway-family",
    location: ["packages/cli/src/cli-entry.ts", "packages/cli/src/intake/tool-definitions.ts"],
    ownerPhase: "11",
    description:
      "registerIntakeTools (project.inspect + contract.approve) exists in this very package but " +
      "defaultRunGatewayMcp never calls it either.",
  },
  {
    id: "gateway.contract-approve",
    kind: "gateway-family",
    location: ["packages/cli/src/cli-entry.ts", "packages/cli/src/intake/tool-definitions.ts"],
    ownerPhase: "11",
    description:
      "Same unwired-at-production-entrypoint gap as gateway.project-inspect, for contract.approve.",
  },
  {
    id: "gateway.capability-audit-approve",
    kind: "gateway-family",
    location: ["packages/cli/src/cli-entry.ts", "packages/detect/src/mcp/tool-definitions.ts"],
    ownerPhase: "12",
    description:
      "registerCapabilityTools (capability.audit + capability.approve) exists in @eo/detect but " +
      "defaultRunGatewayMcp never calls it either.",
  },
];

export const KNOWN_DEFERRED_GATEWAY_PROTOCOL: readonly KnownDeferredEntry[] = [
  {
    id: "gateway.protocol.tools-call",
    kind: "gateway-protocol",
    location: ["packages/cli/src/gateway-mcp/stdio-server.ts"],
    ownerPhase:
      "09/16 (protocol handler itself owned by 09; a real tools/call dispatch exists in " +
      "packages/gateway/src/mcp/server.ts but that module is never invoked from packages/cli)",
    description:
      "The hand-rolled JSON-RPC handler in packages/cli/src/gateway-mcp/stdio-server.ts implements " +
      'only "initialize"/"tools/list" — "tools/call" returns JSON_RPC_METHOD_NOT_FOUND ' +
      "unconditionally, so even a fully-populated registry could never actually be invoked through " +
      "this code path.",
  },
];

export const KNOWN_DEFERRED_ALLOWLIST: readonly KnownDeferredEntry[] = [
  ...KNOWN_DEFERRED_CLI_COMMANDS,
  ...KNOWN_DEFERRED_GATEWAY_FAMILIES,
  ...KNOWN_DEFERRED_GATEWAY_PROTOCOL,
];
