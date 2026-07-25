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
 *
 * SHRUNK 2026-07-25, from 24 entries to 5. The composition-root work of
 * phase 23 wired 18 of them for real, and the sweep — run live, not
 * reasoned about — reported each as a STALE allowlist entry, which is this
 * mechanism working as designed in the opposite direction. Closed:
 * `resume`, `run`, `status-all-runs`, all three `trust-*`, all three
 * `connection-add|list|doctor`, every one of the eight gateway families,
 * `gateway.protocol.tools-call` (the transport is now the real MCP SDK, so
 * a registered tool can actually be invoked), and the `gateway-mcp` dead
 * branch (the hand-rolled server it described no longer exists).
 */

export type KnownDeferredKind =
  "cli-command" | "gateway-family" | "gateway-protocol" | "gateway-provider";

export interface KnownDeferredEntry {
  /** Stable slug — `cli.<command>` or `gateway.<family>` or `gateway.protocol.<method>` or `gateway.provider.<key>`. */
  readonly id: string;
  readonly kind: KnownDeferredKind;
  /** File(s) where the gap lives, relative to the repo root. */
  readonly location: readonly string[];
  /** The roadmap phase that owns wiring the real backend/registration into production. */
  readonly ownerPhase: string;
  readonly description: string;
}

export const KNOWN_DEFERRED_CLI_COMMANDS: readonly KnownDeferredEntry[] = [
  {
    id: "cli.connection-capabilities",
    kind: "cli-command",
    location: ["packages/cli/src/commands/dispatch.ts"],
    ownerPhase: "18/19/20 (connector capability discovery) + 23 (CLI wiring)",
    description:
      '"connection-capabilities" has no backend wired. Its three siblings (connection-add|list|' +
      "doctor) were wired against the durable FileExternalConnectionStore; this one reports a " +
      "connection's discovered CapabilitySnapshot, which needs a live provider client — the same " +
      "per-connection credential work gateway.provider.dispatch below is blocked on.",
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
      "A REAL backend exists (learn-command-backend.ts) and dispatch.ts's conditional branch is " +
      "real, but buildRealCliDependencies() never supplies deps.learning. Wiring it needs one " +
      "genuine design decision first, which is why this was NOT closed alongside trust/connection: " +
      "LearningDependencies requires ChangeSetReferences, and a promoted lesson's ChangeSet " +
      "references have to come from a real intake. Supplying empty/placeholder ids would make " +
      "learn-list and learn-reject work while leaving learn-approve's promotion path failing on an " +
      "opaque schema error — a worse outcome than an honest NOT_IMPLEMENTED.",
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
];

export const KNOWN_DEFERRED_GATEWAY_FAMILIES: readonly KnownDeferredEntry[] = [];

export const KNOWN_DEFERRED_GATEWAY_PROTOCOL: readonly KnownDeferredEntry[] = [];

/**
 * Not a `NOT_IMPLEMENTED` stub, and deliberately NOT part of the live
 * sweep's exact-match set — recorded here so that "every family is wired"
 * is not read as more than it is. The sweep structurally cannot find this
 * one: the tools ARE registered and their dispatch path IS real, so there
 * is no stub to discover.
 */
export const KNOWN_DEFERRED_GATEWAY_PROVIDERS: readonly KnownDeferredEntry[] = [
  {
    id: "gateway.provider.dispatch",
    kind: "gateway-provider",
    location: [
      "packages/cli/src/gateway-mcp/build-tool-registry.ts",
      "packages/connectors-jira/src/provider/register.ts",
      "packages/connectors-grafana/src/provider-registration.ts",
    ],
    ownerPhase: "18/19/20 (connector connection lifecycle) + 23",
    description:
      "buildProductionGatewayToolRegistry constructs EMPTY ProviderRegistry instances, so every " +
      "tracker.*/observability.* call resolves to a typed UnknownProviderError. The tool families " +
      "themselves are genuinely registered and invocable — this is the provider-dispatch axis, " +
      "which is distinct. Populating it is per-connection work needing resolved credentials (Jira " +
      "needs a JiraTokenManager per site; Grafana additionally needs the durable plan-payload and " +
      "rollback stores phase 20 left in memory), so it belongs to connection lifecycle rather than " +
      "to MCP boot.",
  },
];

export const KNOWN_DEFERRED_ALLOWLIST: readonly KnownDeferredEntry[] = [
  ...KNOWN_DEFERRED_CLI_COMMANDS,
  ...KNOWN_DEFERRED_GATEWAY_FAMILIES,
  ...KNOWN_DEFERRED_GATEWAY_PROTOCOL,
];

/** Every tracked deferral, including the ones the live sweep structurally cannot discover. */
export const ALL_TRACKED_DEFERRALS: readonly KnownDeferredEntry[] = [
  ...KNOWN_DEFERRED_ALLOWLIST,
  ...KNOWN_DEFERRED_GATEWAY_PROVIDERS,
];
