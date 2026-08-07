import { describe, expect, it } from "vitest";
import { ConnectorError } from "@crabgic/contracts";
import { GatewayHttpClient, createFakeProviderTransport } from "@crabgic/gateway";
import { buildExternalConnection } from "@crabgic/testkit";
import {
  JiraDatacenterConnectionNotRegisteredError,
  JiraDatacenterConnectionRegistry,
} from "./jira-datacenter-connection-registry.js";
import { JiraConnectionConfigSchema } from "./jira-connection-config.js";

const BASE_URL = "https://dc-registry-test.invalid";

function buildConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return JiraConnectionConfigSchema.parse({
    externalConnectionId: "44444444-4444-4444-8444-444444444444",
    deploymentType: "datacenter",
    authMode: "pat",
    patSecretRef: { backend: "env", variable: "TEST_DC_REGISTRY_PAT" },
    ...overrides,
  });
}

describe("JiraDatacenterConnectionRegistry", () => {
  it("register() then get() returns a fully-wired entry", async () => {
    process.env.TEST_DC_REGISTRY_PAT = "pat-value";
    const registry = new JiraDatacenterConnectionRegistry();
    const connection = buildExternalConnection({
      id: "44444444-4444-4444-8444-444444444444",
      provider: "jira-datacenter",
      deploymentType: "datacenter",
      baseUrl: BASE_URL,
    });
    const fake = createFakeProviderTransport({ responses: [] });
    const entry = await registry.register(connection, buildConfig(), {
      buildHttpClient: async () =>
        new GatewayHttpClient({
          allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
          resolveHostAddresses: async () => ["203.0.113.240"],
          sendRequest: fake.send,
          sleep: async () => undefined,
        }),
    });

    expect(entry.resourceClient).toBeDefined();
    expect(registry.isRegistered(connection.id)).toBe(true);
    expect(registry.get(connection.id)).toBe(entry);
  });

  /**
   * roadmap/19 criterion 3, gap (ii) of defect
   * `19-unrecognized-edition-fallback-kind-unproven`. `register()`'s
   * `discovery → resolveDcEditionFeatures → client` join
   * (`jira-datacenter-connection-registry.ts:87-93`) is the ONLY production
   * path that resolves a `DcEditionEntry` and hands it to the resource
   * client. Measured at `3dec9bf`: replacing that whole expression with
   * `undefined` left 625 test files / 6216 tests green repository-wide,
   * because the only registry test scripted an EMPTY response set — so
   * discovery threw, `.catch(() => undefined)` swallowed it, and no test had
   * ever seen a SUCCESSFUL discovery reach the client.
   *
   * ⚠️ Which case kills which mutation, stated so neither is read as more
   * than it is:
   *   - the 10.3.1 case is the ONLY one that reddens under `dcFeatures =
   *     undefined`; the two refusing cases below stay green under it, since
   *     `undefined` refuses everything.
   *   - the 8.20.1 case is what proves the refusal comes from a
   *     SUCCESSFULLY-discovered unrecognized version rather than from a
   *     failed round trip.
   *   - the empty-script case pins `.catch(() => undefined)` as fail-CLOSED:
   *     a catch that resolved to a permissive default would redden it.
   */
  describe("register()'s discovery → resolveDcEditionFeatures → resourceClient join (production path)", () => {
    async function registerWithDiscovery(
      responses: { status: number; bodyText: string }[],
    ): Promise<Awaited<ReturnType<JiraDatacenterConnectionRegistry["register"]>>> {
      process.env.TEST_DC_REGISTRY_PAT = "pat-value";
      const registry = new JiraDatacenterConnectionRegistry();
      const connection = buildExternalConnection({
        id: "66666666-6666-4666-8666-666666666666",
        provider: "jira-datacenter",
        deploymentType: "datacenter",
        baseUrl: BASE_URL,
      });
      const fake = createFakeProviderTransport({ responses });
      // No `skipDiscovery`, no `dcFeaturesOverride` — this is the production
      // shape of `register()`, the one nothing exercised before.
      return registry.register(connection, buildConfig({ externalConnectionId: connection.id }), {
        buildHttpClient: async () =>
          new GatewayHttpClient({
            allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
            resolveHostAddresses: async () => ["203.0.113.241"],
            sendRequest: fake.send,
            sleep: async () => undefined,
          }),
      });
    }

    const RECOGNIZED_EDITION_DISCOVERY = [
      { status: 200, bodyText: JSON.stringify({ version: "10.3.1" }) },
      {
        status: 200,
        bodyText: JSON.stringify({ permissions: { BROWSE_PROJECTS: { havePermission: true } } }),
      },
    ];

    const UNRECOGNIZED_EDITION_DISCOVERY = [
      { status: 200, bodyText: JSON.stringify({ version: "8.20.1" }) },
      { status: 200, bodyText: JSON.stringify({ permissions: {} }) },
    ];

    it("a SUCCESSFUL 10.3 discovery reaches the client — a mutating plan* call is permitted", async () => {
      const entry = await registerWithDiscovery([...RECOGNIZED_EDITION_DISCOVERY]);
      expect(
        entry.resourceClient.boards.planCreate(
          { name: "B", type: "scrum", projectKeyOrId: "PROJ" },
          "ffffffff-ffff-4fff-8fff-ffffffffffff",
        ).action,
      ).toBe("board.create");
    });

    it("a SUCCESSFUL discovery of an UNRECOGNIZED version falls back to typed unsupported at the client", async () => {
      const entry = await registerWithDiscovery([...UNRECOGNIZED_EDITION_DISCOVERY]);
      try {
        entry.resourceClient.boards.planCreate(
          { name: "B", type: "scrum", projectKeyOrId: "PROJ" },
          "ffffffff-ffff-4fff-8fff-ffffffffffff",
        );
        throw new Error("expected the unrecognized-edition fallback to refuse");
      } catch (err) {
        expect(err).toBeInstanceOf(ConnectorError);
        expect((err as ConnectorError).kind).toBe("unsupported");
        expect((err as ConnectorError).provider).toBe("jira-datacenter");
        expect((err as ConnectorError).message).toContain(
          "has not been positively confirmed by discovery",
        );
      }
    });

    it("a FAILED discovery is swallowed fail-CLOSED — the client still refuses with typed unsupported", async () => {
      const entry = await registerWithDiscovery([]);
      try {
        entry.resourceClient.boards.planCreate(
          { name: "B", type: "scrum", projectKeyOrId: "PROJ" },
          "ffffffff-ffff-4fff-8fff-ffffffffffff",
        );
        throw new Error("expected a failed discovery to leave the client refusing");
      } catch (err) {
        expect(err).toBeInstanceOf(ConnectorError);
        expect((err as ConnectorError).kind).toBe("unsupported");
        expect((err as ConnectorError).message).toContain(
          "has not been positively confirmed by discovery",
        );
      }
    });
  });

  it("get() throws JiraDatacenterConnectionNotRegisteredError for an unregistered connection id", () => {
    const registry = new JiraDatacenterConnectionRegistry();
    expect(() => registry.get("never-registered")).toThrow(
      JiraDatacenterConnectionNotRegisteredError,
    );
  });

  it("register() rejects pre-network (no HTTP client built) for a disallowed basic-auth config", async () => {
    const registry = new JiraDatacenterConnectionRegistry();
    const connection = buildExternalConnection({
      id: "55555555-5555-4555-8555-555555555555",
      provider: "jira-datacenter",
      deploymentType: "datacenter",
      baseUrl: BASE_URL,
    });
    let httpClientBuilt = false;
    await expect(
      registry.register(
        connection,
        buildConfig({
          externalConnectionId: connection.id,
          authMode: "basic",
          allowBasicAuth: false,
          basicAuthUsernameSecretRef: { backend: "env", variable: "X" },
          basicAuthPasswordSecretRef: { backend: "env", variable: "Y" },
        }),
        {
          buildHttpClient: async () => {
            httpClientBuilt = true;
            throw new Error("should never be called");
          },
        },
      ),
    ).rejects.toThrow(ConnectorError);
    expect(httpClientBuilt).toBe(false);
  });
});
