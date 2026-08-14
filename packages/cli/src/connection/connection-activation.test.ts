import { describe, expect, it, vi } from "vitest";
import { CURRENT_SCHEMA_VERSION, type ExternalConnection } from "@crabgic/contracts";
import { JiraConnectionRegistry } from "@crabgic/connectors-jira";
import type { GatewayHttpClient } from "@crabgic/gateway";
import { createConnectionActivator } from "./connection-activation.js";
import type { JiraConnectionConfigStore } from "./jira-config-store.js";

function connection(overrides: Partial<ExternalConnection> = {}): ExternalConnection {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "99999999-9999-4999-8999-999999999999",
    provider: "jira-cloud",
    baseUrl: "https://example.atlassian.net",
    allowedRedirectOrigins: [],
    allowedResources: ["issue"],
    allowedActions: ["read"],
    discoveryTtlSeconds: 900,
    secretRef: { backend: "env", variable: "JIRA_TOKEN" },
    ...overrides,
  };
}

function configStore(configs: Record<string, unknown> = {}): JiraConnectionConfigStore {
  return {
    get: async (id: string) => configs[id] as never,
    list: async () => Object.values(configs) as never,
    put: async (c) => c,
    remove: async () => undefined,
  };
}

const BASIC_CONFIG = (id: string) => ({
  externalConnectionId: id,
  deploymentType: "cloud" as const,
  authMode: "basic" as const,
  allowBasicAuth: false,
  basicAuthUsernameSecretRef: { backend: "env" as const, variable: "JIRA_EMAIL" },
  basicAuthPasswordSecretRef: { backend: "env" as const, variable: "JIRA_TOKEN" },
});

/** Never dials: registration builds a client but issues no request. */
const fakeHttpClient = async (): Promise<GatewayHttpClient> =>
  ({ request: async () => ({ status: 200, headers: {}, bodyText: "{}" }) }) as never;

function build(
  overrides: Parameters<typeof createConnectionActivator>[0] extends infer T
    ? Partial<T>
    : never = {},
) {
  const jira = new JiraConnectionRegistry();
  const activate = createConnectionActivator({
    jira,
    jiraConfigs: configStore({ [connection().id]: BASIC_CONFIG(connection().id) }),
    buildJiraHttpClient: fakeHttpClient,
    ...overrides,
  } as never);
  return { jira, activate };
}

/**
 * Issue #135, defect 3 — the defect the reporter identified as gating the
 * other two: "`buildProviderDispatchWiring()` returns the registries it
 * creates ... but nothing ever calls `.register(connection, ...)` on
 * either. `dispatch.jira` and `dispatch.grafana` have no call sites
 * outside that construction, so `registry.get(connectionId)` throws for
 * every connection."
 *
 * These tests assert the property that was missing outright: after
 * activation, the connector's own per-connection registry can find the
 * connection.
 */
describe("createConnectionActivator", () => {
  it("registers a Jira connection into the registry the routed client reads", async () => {
    const { jira, activate } = build();
    const conn = connection();
    expect(jira.isRegistered(conn.id)).toBe(false);

    await activate(conn);

    expect(jira.isRegistered(conn.id)).toBe(true);
    // The lookup the routed provider client actually performs.
    expect(() => jira.get(conn.id)).not.toThrow();
  });

  it("wires the connection's configured auth scheme, not a hardcoded Bearer", async () => {
    process.env.JIRA_EMAIL = "ops@example.com";
    process.env.JIRA_TOKEN = "ATATT-token";
    try {
      const { jira, activate } = build();
      const conn = connection();
      await activate(conn);
      const headers = await jira.get(conn.id).ctx.authHeaderProvider!();
      expect(headers["authorization"]).toMatch(/^Basic /);
    } finally {
      delete process.env.JIRA_EMAIL;
      delete process.env.JIRA_TOKEN;
    }
  });

  it("is idempotent — a second activation does not re-register", async () => {
    const { jira, activate } = build();
    const conn = connection();
    const spy = vi.spyOn(jira, "register");
    await activate(conn);
    await activate(conn);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("single-flights concurrent activations of the same connection", async () => {
    // Every dispatch calls the activator, and a burst of parallel tool
    // calls is the normal case — each building its own HTTP client and
    // racing to overwrite the entry would be waste at best.
    const { jira, activate } = build();
    const conn = connection();
    const spy = vi.spyOn(jira, "register");
    await Promise.all([activate(conn), activate(conn), activate(conn)]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed activation rather than caching the failure", async () => {
    // A credential that was not yet exported, then is: the next call must
    // get a fresh attempt, not a cached rejection.
    let configs: Record<string, unknown> = {};
    const jira = new JiraConnectionRegistry();
    const activate = createConnectionActivator({
      jira,
      jiraConfigs: {
        get: async (id: string) => configs[id] as never,
        list: async () => [],
        put: async (c: never) => c,
        remove: async () => undefined,
      },
      buildJiraHttpClient: fakeHttpClient,
    } as never);
    const conn = connection();

    await expect(activate(conn)).rejects.toThrow();
    configs = { [conn.id]: BASIC_CONFIG(conn.id) };
    await expect(activate(conn)).resolves.toBeUndefined();
    expect(jira.isRegistered(conn.id)).toBe(true);
  });

  it("refuses a Jira connection with no stored config, naming what is missing", async () => {
    const jira = new JiraConnectionRegistry();
    const activate = createConnectionActivator({
      jira,
      jiraConfigs: configStore({}),
      buildJiraHttpClient: fakeHttpClient,
    } as never);
    await expect(activate(connection())).rejects.toThrow(/config/i);
  });

  it("does nothing for a provider it does not own, rather than failing the dispatch", async () => {
    const { activate } = build();
    await expect(activate(connection({ provider: "servicenow" }))).resolves.toBeUndefined();
  });
});
