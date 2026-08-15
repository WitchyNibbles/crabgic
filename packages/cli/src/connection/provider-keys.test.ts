import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type ExternalConnection } from "@crabgic/contracts";
import {
  InMemoryExternalConnectionStore,
  type ExternalConnectionRepository,
} from "@crabgic/gateway";
import { CliUsageError } from "../errors.js";
import {
  normalizeStoredConnectionProvider,
  resolveDispatchProviderKey,
  withProviderKeyNormalization,
} from "./provider-keys.js";

function buildConnection(overrides: Partial<ExternalConnection> = {}): ExternalConnection {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "77777777-7777-4777-8777-777777777777",
    provider: "jira-cloud",
    baseUrl: "https://example.atlassian.net",
    allowedRedirectOrigins: [],
    allowedResources: ["issue"],
    allowedActions: ["read"],
    discoveryTtlSeconds: 900,
    secretRef: { backend: "env", variable: "TOKEN" },
    ...overrides,
  };
}

/**
 * Defect 2 of issue #135: `connection add` accepted only `jira`, and
 * `registerJiraCloudProvider` registers under `"jira-cloud"`, so
 * `ProviderRegistry.resolve(connection.provider)` threw
 * `no client registered for provider "jira"` for EVERY Jira connection
 * ever created. These tests pin the owner's option-A ruling: the stored
 * `provider` IS the dispatch key (as `ExternalConnectionSchema` already
 * documents it), and the CLI's `jira|grafana` vocabulary is mapped onto
 * it at `connection add` time rather than stored raw.
 */
describe("resolveDispatchProviderKey", () => {
  it("maps jira with no declared deployment to the Cloud dispatch key", () => {
    expect(resolveDispatchProviderKey("jira", undefined)).toBe("jira-cloud");
  });

  it("maps jira --deployment cloud to the Cloud dispatch key", () => {
    expect(resolveDispatchProviderKey("jira", "cloud")).toBe("jira-cloud");
  });

  it("maps jira --deployment datacenter to the Data Center dispatch key", () => {
    expect(resolveDispatchProviderKey("jira", "datacenter")).toBe("jira-datacenter");
  });

  it("refuses a jira deployment outside the connector's own closed union", () => {
    expect(() => resolveDispatchProviderKey("jira", "server")).toThrow(CliUsageError);
    expect(() => resolveDispatchProviderKey("jira", "server")).toThrow(/cloud\|datacenter/);
  });

  it("maps grafana to its own dispatch key regardless of deployment type", () => {
    // Grafana routes BY CAPABILITY, not by declared deployment (roadmap/20),
    // so its edition never forks the dispatch key the way Jira's does.
    expect(resolveDispatchProviderKey("grafana", undefined)).toBe("grafana");
    expect(resolveDispatchProviderKey("grafana", "oss")).toBe("grafana");
    expect(resolveDispatchProviderKey("grafana", "enterprise")).toBe("grafana");
  });

  it("returns keys that are byte-identical to the ones the connectors register under", async () => {
    // The whole defect was two spellings of one concept drifting apart.
    // Asserting against the literal would reproduce the drift, so this
    // asserts against the connectors' OWN exported constants.
    const { JIRA_CLOUD_PROVIDER_KEY, JIRA_DATACENTER_PROVIDER_KEY } =
      await import("@crabgic/connectors-jira");
    const { GRAFANA_PROVIDER_NAME } = await import("@crabgic/connectors-grafana");

    expect(resolveDispatchProviderKey("jira", "cloud")).toBe(JIRA_CLOUD_PROVIDER_KEY);
    expect(resolveDispatchProviderKey("jira", "datacenter")).toBe(JIRA_DATACENTER_PROVIDER_KEY);
    expect(resolveDispatchProviderKey("grafana", undefined)).toBe(GRAFANA_PROVIDER_NAME);
  });
});

/**
 * Records created by 1.7.0 and earlier carry the un-dispatchable
 * `provider: "jira"`. They are migrated on READ rather than by a
 * rewrite-in-place pass: the store is shared with a possibly-older
 * co-installed CLI, and a read-side projection cannot corrupt a record
 * a rollback would then have to un-migrate.
 */
describe("normalizeStoredConnectionProvider", () => {
  it("migrates a legacy jira record with no deployment type to the Cloud key", () => {
    const migrated = normalizeStoredConnectionProvider(buildConnection({ provider: "jira" }));
    expect(migrated.provider).toBe("jira-cloud");
  });

  it("migrates a legacy jira record declaring datacenter to the Data Center key", () => {
    const migrated = normalizeStoredConnectionProvider(
      buildConnection({ provider: "jira", deploymentType: "datacenter" }),
    );
    expect(migrated.provider).toBe("jira-datacenter");
  });

  it("leaves an already-canonical record untouched, by identity", () => {
    const connection = buildConnection({ provider: "jira-cloud" });
    expect(normalizeStoredConnectionProvider(connection)).toBe(connection);
  });

  it("leaves a grafana record untouched, by identity", () => {
    const connection = buildConnection({ provider: "grafana" });
    expect(normalizeStoredConnectionProvider(connection)).toBe(connection);
  });

  it("leaves an unrecognized provider untouched rather than guessing a key for it", () => {
    const connection = buildConnection({ provider: "servicenow" });
    expect(normalizeStoredConnectionProvider(connection)).toBe(connection);
  });

  it("never mutates the record it is handed", () => {
    const connection = buildConnection({ provider: "jira" });
    normalizeStoredConnectionProvider(connection);
    expect(connection.provider).toBe("jira");
  });

  it("is idempotent — migrating a migrated record is a no-op", () => {
    const once = normalizeStoredConnectionProvider(buildConnection({ provider: "jira" }));
    expect(normalizeStoredConnectionProvider(once)).toBe(once);
  });
});

describe("withProviderKeyNormalization", () => {
  async function seedLegacyJira(): Promise<{
    readonly repository: ExternalConnectionRepository;
    readonly id: string;
  }> {
    const inner = new InMemoryExternalConnectionStore();
    const created = await inner.create({
      provider: "jira",
      baseUrl: "https://example.atlassian.net",
      allowedRedirectOrigins: [],
      allowedResources: ["issue"],
      allowedActions: ["read"],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "TOKEN" },
    });
    return { repository: withProviderKeyNormalization(inner), id: created.id };
  }

  it("migrates on get", async () => {
    const { repository, id } = await seedLegacyJira();
    expect((await repository.get(id))?.provider).toBe("jira-cloud");
  });

  it("migrates on list", async () => {
    const { repository } = await seedLegacyJira();
    expect((await repository.list()).map((c) => c.provider)).toEqual(["jira-cloud"]);
  });

  it("migrates on create, so a record written through the wrapper is dispatchable", async () => {
    const repository = withProviderKeyNormalization(new InMemoryExternalConnectionStore());
    const created = await repository.create({
      provider: "jira",
      baseUrl: "https://example.atlassian.net",
      allowedRedirectOrigins: [],
      allowedResources: ["issue"],
      allowedActions: ["read"],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "TOKEN" },
    });
    expect(created.provider).toBe("jira-cloud");
  });

  it("migrates on update", async () => {
    const { repository, id } = await seedLegacyJira();
    const updated = await repository.update(id, { discoveryTtlSeconds: 60 });
    expect(updated.provider).toBe("jira-cloud");
    expect(updated.discoveryTtlSeconds).toBe(60);
  });

  it("returns undefined for a missing id rather than normalizing nothing into a record", async () => {
    const repository = withProviderKeyNormalization(new InMemoryExternalConnectionStore());
    expect(await repository.get("00000000-0000-4000-8000-000000000000")).toBeUndefined();
  });

  it("passes remove through to the wrapped store", async () => {
    const { repository, id } = await seedLegacyJira();
    await repository.remove(id);
    expect(await repository.get(id)).toBeUndefined();
  });
});
