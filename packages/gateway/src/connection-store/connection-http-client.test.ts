import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type ExternalConnection } from "@eo/contracts";
import {
  buildAllowlistForConnection,
  buildHttpClientForConnection,
  resolveCustomCaPem,
} from "./connection-http-client.js";

function buildConnection(overrides: Partial<ExternalConnection> = {}): ExternalConnection {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "12121212-1212-4212-8212-121212121212",
    provider: "jira",
    baseUrl: "https://example.atlassian.net",
    allowedRedirectOrigins: ["https://redirect-target.example.com"],
    allowedResources: ["issue"],
    allowedActions: ["read"],
    discoveryTtlSeconds: 900,
    secretRef: { backend: "env", variable: "X" },
    ...overrides,
  };
}

describe("buildAllowlistForConnection", () => {
  it("allowlists the connection's own base origin plus every declared redirect origin", () => {
    const allowlist = buildAllowlistForConnection(buildConnection());
    expect(allowlist.allowedSchemes).toEqual(["https:"]);
    expect(allowlist.allowedOrigins).toEqual([
      "https://example.atlassian.net",
      "https://redirect-target.example.com",
    ]);
  });
});

describe("resolveCustomCaPem", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eo-gateway-connection-http-client-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns undefined when no customCaRef is configured", async () => {
    await expect(resolveCustomCaPem(buildConnection())).resolves.toBeUndefined();
  });

  it("reads the PEM off disk when customCaRef is configured", async () => {
    const caPath = join(dir, "ca.pem");
    await writeFile(caPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n");
    await chmod(caPath, 0o600);
    const pem = await resolveCustomCaPem(buildConnection({ customCaRef: { path: caPath } }));
    expect(pem).toContain("BEGIN CERTIFICATE");
  });
});

describe("buildHttpClientForConnection", () => {
  it("builds a GatewayHttpClient without throwing when no custom CA is configured", async () => {
    const client = await buildHttpClientForConnection(buildConnection());
    expect(client).toBeDefined();
  });

  it("builds a GatewayHttpClient honoring a configured custom CA", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eo-gateway-connection-http-client-ca-"));
    try {
      const caPath = join(dir, "ca.pem");
      await writeFile(caPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n");
      await chmod(caPath, 0o600);
      const client = await buildHttpClientForConnection(
        buildConnection({ customCaRef: { path: caPath } }),
      );
      expect(client).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts test-only overrides (e.g. a fake sendRequest/resolveHostAddresses)", async () => {
    const sendRequest = async () => ({ status: 200, headers: {}, bodyText: "{}" });
    const client = await buildHttpClientForConnection(buildConnection(), {
      sendRequest,
      resolveHostAddresses: async () => ["203.0.113.7"],
    });
    const response = await client.request({
      connectionId: "conn-1",
      tenant: "t1",
      resource: "r1",
      url: new URL("https://example.atlassian.net/rest"),
      method: "GET",
    });
    expect(response.status).toBe(200);
  });
});
