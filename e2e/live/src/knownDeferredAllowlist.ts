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
 * SHRUNK 2026-07-25, from 24 entries to 1; the two surviving entries were
 * both NARROWED later the same day by WP5, which closed the halves of each
 * that turned out not to need credentials at all — see each entry.
 *
 * SHRUNK 2026-07-25, from 24 entries to 1. The composition-root work of
 * phase 23 wired 18 of them for real, and the sweep — run live, not
 * reasoned about — reported each as a STALE allowlist entry, which is this
 * mechanism working as designed in the opposite direction. Closed:
 * `resume`, `run`, `status-all-runs`, all three `trust-*`, all three
 * `connection-add|list|doctor`, every one of the eight gateway families,
 * `gateway.protocol.tools-call` (the transport is now the real MCP SDK, so
 * a registered tool can actually be invoked), and the `gateway-mcp` dead
 * branch (the hand-rolled server it described no longer exists).
 *
 * The four `learn-*` entries closed last, once the owner ruled that a
 * promoted lesson rides an intake ALREADY in flight rather than needing an
 * intake of its own — which is what unblocked supplying `deps.learning`
 * without fabricating ChangeSet references. See
 * `packages/cli/src/learning/ongoing-intake-refs.ts`.
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
      'NARROWED 2026-07-25 (WP5). "connection-capabilities" now HAS a backend ' +
      "(packages/cli/src/connection/connection-capabilities.ts) and dispatch.ts's branch is no " +
      "longer unconditional: it is gated on ConnectionDependencies.discoverCapabilities, the " +
      "injected counterpart to the `probe` that backs connection-doctor. What remains deferred is " +
      "supplying that discoverer in production, and it is deferred on two CONCRETE blockers, not " +
      "on the previous over-broad claim that no plumbing exists. (1) Jira: " +
      "discoverJiraCapabilitySnapshot is real and its JiraHttpContext is fully constructible — " +
      "JiraTokenManager IS exported, contrary to the stale note this entry used to rest on — but " +
      "nothing PERSISTS a JiraConnectionConfig, so the OAuth client-credentials pair " +
      "(oauthClientIdSecretRef/oauthClientSecretRef, added to JiraConnectionConfigSchema in WP5) " +
      "cannot be resolved for a stored connection, and ExternalConnection carries exactly one " +
      "secretRef by a roadmap/19 ruling that must not be widened. (2) Grafana: " +
      "GrafanaBuildInfoResponse is documented in its own file as fixture data, NOT an assertion " +
      "about Grafana's wire format, pending live verification — implementing fetchBuildInfo " +
      "against it would be guessing at an unverified engine fact. The containerized-Grafana run " +
      "is where (2) gets settled.",
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
      "NARROWED 2026-07-25 (WP5) — the PROVIDER half is closed, the CONNECTION half is not. " +
      "buildProductionGatewayToolRegistry no longer constructs EMPTY ProviderRegistry instances: " +
      "bootstrap.ts's buildProviderDispatchWiring calls registerJiraCloudProvider and " +
      "registerRoutedGrafanaProvider (both credential-free — two registries in, a per-connection " +
      "registry out, no secret resolved and no I/O) and threads the populated registries through " +
      "ProductionGatewayToolRegistryDeps. (Both halves of that registrar claim are exercised " +
      "end to end by packages/cli/src/gateway-mcp/build-tool-registry.test.ts, over a real " +
      "jira-cloud AND a real grafana connection — the Jira half was previously asserted here " +
      "and verified nowhere.) Grafana's durable plan-payload and rollback stores now exist too " +
      "(connectors-grafana/src/mutation/file-backed-store.ts) and are CONSTRUCTED at boot under " +
      "the project's XDG state root, 0600; they are not yet CONSUMED, because the register() " +
      "call that would take them is the deferred half described next. So a tracker.*/" +
      "observability.* call on a configured connection no longer answers the misleading " +
      'UnknownProviderError ("this build has no Jira connector"); it answers the typed ' +
      "Jira/GrafanaConnectionNotRegisteredError. What genuinely remains is the per-CONNECTION " +
      "register() call: JiraConnectionRegistry.register needs a JiraTokenManager built from the " +
      "OAuth client-credentials pair, and GrafanaConnectionRegistry.register needs a resolved " +
      "service-account token plus a verified capability snapshot. Both need live credentials and " +
      "belong to connection lifecycle, not to MCP boot.",
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
