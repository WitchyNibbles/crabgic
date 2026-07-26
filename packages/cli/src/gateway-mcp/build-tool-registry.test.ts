import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryExternalConnectionStore,
  ProviderRegistry,
  type GenericProviderClient,
  type MutationApplyClient,
} from "@crabgic/gateway";
import { createJournalStore } from "@crabgic/journal";
import { createInMemoryRegistry } from "@crabgic/supervisor";
import { ApprovalTokenMinter } from "@crabgic/contracts";
import type {
  AuthorizationEnvelope,
  ChangeSet,
  IntentContract,
  WorkUnit,
} from "@crabgic/contracts";
import { createCapabilityStore } from "@crabgic/detect";
import { registerJiraCloudProvider } from "@crabgic/connectors-jira";
import { registerRoutedGrafanaProvider } from "@crabgic/connectors-grafana";
import { buildRealCliDependencies, buildRealGatewayToolRegistry } from "../bootstrap.js";
import {
  buildProductionGatewayToolRegistry,
  type ProductionGatewayToolRegistryDeps,
} from "./build-tool-registry.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "eo-gateway-registry-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function realRegistry() {
  return buildRealGatewayToolRegistry({
    xdgEnv: { HOME: home },
    projectHash: "registry-hash",
  });
}

/**
 * The non-provider half of `ProductionGatewayToolRegistryDeps`, wired to
 * throwaway in-memory state — every provider-dispatch test below varies
 * only `connections`/`providers`/`mutationApplyClients`.
 */
function stubDeps(): Omit<ProductionGatewayToolRegistryDeps, "providers" | "mutationApplyClients"> {
  const journal = createJournalStore({ journalDir: join(home, "journal") });
  const minter = new ApprovalTokenMinter({ secretKey: Buffer.alloc(32, 7), journal });
  const store = createCapabilityStore(join(home, "capability-store"));
  return {
    journal,
    connections: new InMemoryExternalConnectionStore(),
    supervisorSocketPath: join(home, "control.sock"),
    approvalSigningKey: Buffer.alloc(32, 7),
    changeSets: createInMemoryRegistry<ChangeSet>(),
    workUnits: createInMemoryRegistry<WorkUnit>(),
    envelopes: createInMemoryRegistry<AuthorizationEnvelope>(),
    intentContracts: createInMemoryRegistry<IntentContract>(),
    capability: { store },
    approvalTokenVerifier: minter,
    resolveCapabilityStoreKey: () => undefined,
  };
}

/**
 * The eight families interface-ledger Gap 1 counts, and the leaf names each
 * contributes. Asserted against the REAL production builder — the whole
 * point of this file is that the shipped `gateway mcp` server is populated,
 * which it was not until 2026-07-25: `cli-entry.ts` booted an empty
 * registry, so every one of these was unreachable from the binary.
 */
const EXPECTED_TOOL_NAMES = [
  // 16 native — tracker (7)
  "tracker.search",
  "tracker.get",
  "tracker.plan_create",
  "tracker.plan_update",
  "tracker.plan_transition",
  "tracker.plan_comment",
  "tracker.apply",
  // 16 native — observability (6)
  "observability.search",
  "observability.get",
  "observability.query",
  "observability.plan_create",
  "observability.plan_update",
  "observability.apply",
  // 16 native — evidence (2), result (1), forwarded run.* (2)
  "evidence.attach",
  "evidence.get",
  "result.submit",
  "run.status",
  "run.cancel",
  // 11 (2)
  "project.inspect",
  "contract.approve",
  // 12 (2)
  "capability.audit",
  "capability.approve",
];

describe("buildRealGatewayToolRegistry", () => {
  it("registers every family the shipped binary is supposed to expose", () => {
    expect([...realRegistry().toolNames].sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it("gives every registered tool a real, invocable handler — never a descriptor-only stub", () => {
    for (const tool of realRegistry().list()) {
      expect(typeof tool.handler, `${tool.name} has no handler`).toBe("function");
      expect(tool.description.length, `${tool.name} has no description`).toBeGreaterThan(0);
    }
  });

  /**
   * `project.inspect` is the one family leaf that needs no external
   * connection and no pre-minted token, so it is the honest end-to-end
   * proof that a handler reaches real subsystems: it reads 04's journal and
   * the durable ChangeSet registry, and degrades gracefully before either
   * has content rather than throwing.
   */
  it("INVOKES project.inspect against the real journal and ChangeSet registry", async () => {
    const result = await realRegistry().get("project.inspect")!.handler({});
    const report = JSON.parse(result.content[0]!.text) as {
      changeSets: unknown[];
      degraded: string[];
    };

    expect(report.changeSets).toEqual([]);
    expect(report.degraded.length).toBeGreaterThan(0);
  });

  /**
   * `contract.approve` must refuse before it ever reaches token
   * verification when the ChangeSet is unknown — the fail-closed path a
   * caller hits with a fabricated id.
   */
  it("refuses contract.approve for an unknown ChangeSet without consulting the token", async () => {
    const result = await realRegistry()
      .get("contract.approve")!
      .handler({
        changeSetId: "00000000-0000-4000-8000-000000000000",
        digest: "a".repeat(64),
        token: "not-a-real-token",
      });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("unknown ChangeSet");
  });

  /** A tracker call with no connector configured must map to a typed connector error, not an unhandled throw. */
  it("answers a tracker call with a typed error when no connection is configured", async () => {
    const result = await realRegistry().get("tracker.search")!.handler({
      connectionId: "missing-connection",
      params: {},
    });

    expect(result.isError).toBe(true);
  });
});

/**
 * WP5 (2026-07-25) — provider-dispatch population.
 *
 * `buildProductionGatewayToolRegistry` used to construct two EMPTY
 * `ProviderRegistry` instances inline, so `tracker.*`/`observability.*`
 * resolved to `UnknownProviderError` for a correctly-configured Jira or
 * Grafana connection: the tools were registered, but nothing was ever
 * registered BEHIND them. These tests assert the registries are now
 * supplied by the caller and actually carry the two connector providers.
 */
describe("buildProductionGatewayToolRegistry — provider dispatch", () => {
  it("carries the jira-cloud and grafana provider keys, not an empty registry", () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    registerJiraCloudProvider({ providers, mutationApplyClients });
    registerRoutedGrafanaProvider({ providers, mutationApplyClients });

    buildProductionGatewayToolRegistry({ ...stubDeps(), providers, mutationApplyClients });

    expect([...providers.registeredProviders].sort()).toEqual(["grafana", "jira-cloud"]);
    expect([...mutationApplyClients.registeredProviders].sort()).toEqual(["grafana", "jira-cloud"]);
  });

  /**
   * The behavioural claim WP5 makes: for a REAL, stored Jira connection,
   * dispatch no longer answers "no such provider" — it answers the typed
   * per-connection error, which is strictly more honest.
   */
  it("a tracker call on a stored jira-cloud connection no longer reports an unknown provider", async () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    registerJiraCloudProvider({ providers, mutationApplyClients });

    const connections = new InMemoryExternalConnectionStore();
    const connection = await connections.create({
      provider: "jira-cloud",
      baseUrl: "https://example.atlassian.net",
      secretRef: { backend: "env", variable: "JIRA_TOKEN" },
      allowedRedirectOrigins: [],
      allowedResources: ["issue"],
      allowedActions: ["get"],
      discoveryTtlSeconds: 900,
    });

    const registry = buildProductionGatewayToolRegistry({
      ...stubDeps(),
      connections,
      providers,
      mutationApplyClients,
    });

    const result = await registry.get("tracker.search")!.handler({
      connectionId: connection.id,
      params: { connectionId: connection.id, resource: "issue" },
    });

    expect(result.isError).toBe(true);
    const error = JSON.parse(result.content[0]!.text) as { message: string };
    expect(error.message).not.toContain("no client registered for provider");
    expect(error.message).toContain("never registered");
  });

  it("an observability call on a stored grafana connection reports the per-connection error too", async () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    registerRoutedGrafanaProvider({ providers, mutationApplyClients });

    const connections = new InMemoryExternalConnectionStore();
    const connection = await connections.create({
      provider: "grafana",
      baseUrl: "https://grafana.example.com",
      secretRef: { backend: "env", variable: "GRAFANA_TOKEN" },
      allowedRedirectOrigins: [],
      allowedResources: ["dashboard"],
      allowedActions: ["list"],
      discoveryTtlSeconds: 900,
    });

    const registry = buildProductionGatewayToolRegistry({
      ...stubDeps(),
      connections,
      providers,
      mutationApplyClients,
    });

    const result = await registry.get("observability.search")!.handler({
      connectionId: connection.id,
      params: { connectionId: connection.id, resourceKind: "dashboard" },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("never registered");
  });

  /**
   * The real bootstrap wiring must populate them — not just the unit-level
   * composition above. The proof is behavioural, because the registry
   * object deliberately does not expose its providers: a REAL connection,
   * stored through the real durable connection store, must dispatch past
   * provider lookup and reach the per-connection error.
   *
   * ADVERSARIAL-REVIEW FIX (2026-07-25): this test used to exercise only
   * the GRAFANA half despite its title, and its Jira half was pinned by
   * nothing — deleting `registerJiraCloudProvider` from
   * `bootstrap.ts`'s `buildProviderDispatchWiring` left the entire
   * packages/cli suite green while `e2e/live/src/knownDeferredAllowlist.ts`
   * asserted, as gate-visible evidence, that bootstrap calls BOTH
   * registrars. Both arms now run against the same real wiring.
   */
  it("buildRealGatewayToolRegistry populates both provider registries end to end", async () => {
    const overrides = { xdgEnv: { HOME: home }, projectHash: "registry-hash" } as const;
    const deps = buildRealCliDependencies(overrides);
    const grafana = await deps.connection!.repository.create({
      provider: "grafana",
      baseUrl: "https://grafana.example.com",
      secretRef: { backend: "env", variable: "GRAFANA_TOKEN" },
      allowedRedirectOrigins: [],
      allowedResources: ["dashboard"],
      allowedActions: ["list"],
      discoveryTtlSeconds: 900,
    });
    const jira = await deps.connection!.repository.create({
      provider: "jira-cloud",
      baseUrl: "https://example.atlassian.net",
      secretRef: { backend: "env", variable: "JIRA_TOKEN" },
      allowedRedirectOrigins: [],
      allowedResources: ["issue"],
      allowedActions: ["get"],
      discoveryTtlSeconds: 900,
    });

    const registry = buildRealGatewayToolRegistry(overrides);

    const observability = await registry.get("observability.search")!.handler({
      connectionId: grafana.id,
      params: { connectionId: grafana.id, resourceKind: "dashboard" },
    });
    expect(observability.isError).toBe(true);
    expect(observability.content[0]!.text).toContain("never registered");
    expect(observability.content[0]!.text).not.toContain("no client registered for provider");

    // The Jira arm, asserted the same way: "never registered" is the
    // per-CONNECTION error that proves the provider key IS present, and
    // the negative assertion is what distinguishes it from the
    // `UnknownProviderError` an unpopulated registry produces.
    const tracker = await registry.get("tracker.search")!.handler({
      connectionId: jira.id,
      params: { connectionId: jira.id, resource: "issue" },
    });
    expect(tracker.isError).toBe(true);
    expect(tracker.content[0]!.text).toContain("never registered");
    expect(tracker.content[0]!.text).not.toContain("no client registered for provider");
  });
});
