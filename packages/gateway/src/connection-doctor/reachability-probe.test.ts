import { createServer, type Server } from "node:https";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type ExternalConnection } from "@eo/contracts";
import { GatewayHttpClient } from "../transport/http-client.js";
import { sendHttpRequest, type HttpTransportRequest } from "../transport/http-transport.js";
import {
  generateSelfSignedCert,
  type DisposableCert,
} from "../transport/test-support/self-signed-cert.js";
import { probeConnectionReachability } from "./reachability-probe.js";

/**
 * Test-only transport wrapper: the SSRF-guard preflight inside
 * `GatewayHttpClient` is satisfied here with a fake, non-loopback
 * `resolveHostAddresses` answer (203.0.113.7, per this file's own
 * long-standing convention — SSRF-guard behavior itself has its own
 * dedicated tests in `../transport/ssrf-guard.test.ts` and
 * `../transport/http-client.test.ts`, not re-proven here). Since HIGH #1's
 * DNS-pinning fix now dials whatever address the SSRF check validated,
 * this wrapper overrides the ACTUAL dial target back to the real
 * disposable local server's loopback address — otherwise every real-
 * network test below would try to dial the fake placeholder address
 * instead of the real fixture server and hang. This is exactly analogous
 * to production: a real deployment's `resolveHostAddresses` would return
 * the connection's OWN true resolved address, and pinning would dial
 * that — never a fake one; only this test's own stand-in resolver lies.
 */
function realNetworkSendRequestPinnedTo(pinnedAddress: string): typeof sendHttpRequest {
  return (req: HttpTransportRequest) => sendHttpRequest({ ...req, pinnedAddress });
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("expected AddressInfo");
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("probeConnectionReachability", () => {
  let cert: DisposableCert;
  let server: Server;
  let port: number;
  let dir: string;

  beforeAll(async () => {
    cert = await generateSelfSignedCert();
    server = createServer({ key: cert.keyPem, cert: cert.certPem }, (_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    port = await listen(server);
  });

  afterAll(async () => {
    await close(server);
    await cert.cleanup();
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eo-gateway-doctor-"));
    process.env.EO_GATEWAY_DOCTOR_TEST_SECRET = "token-value";
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.EO_GATEWAY_DOCTOR_TEST_SECRET;
  });

  function buildConnection(overrides: Partial<ExternalConnection> = {}): ExternalConnection {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: "66666666-6666-4666-8666-666666666666",
      provider: "jira",
      baseUrl: `https://127.0.0.1:${port}`,
      allowedRedirectOrigins: [],
      allowedResources: ["issue"],
      allowedActions: ["read"],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "EO_GATEWAY_DOCTOR_TEST_SECRET" },
      ...overrides,
    };
  }

  function buildClientForFixture(customCaPem?: string): GatewayHttpClient {
    return new GatewayHttpClient({
      allowlist: { allowedSchemes: ["https:"], allowedOrigins: [`https://127.0.0.1:${port}`] },
      resolveHostAddresses: async () => ["203.0.113.7"],
      sendRequest: realNetworkSendRequestPinnedTo("127.0.0.1"),
      ...(customCaPem !== undefined ? { customCaPem } : {}),
    });
  }

  it("succeeds against a disposable fixture connection when the custom CA is supplied", async () => {
    const caPath = join(dir, "ca.pem");
    await writeFile(caPath, cert.certPem);
    await chmod(caPath, 0o600);

    const connection = buildConnection({ customCaRef: { path: caPath } });
    const result = await probeConnectionReachability(connection, {
      buildClient: (_c, customCaPem) => buildClientForFixture(customCaPem),
    });

    expect(result.reachable).toBe(true);
    expect(result.status).toBe(200);
  });

  it("fails informatively when no custom CA is supplied against a self-signed server", async () => {
    const connection = buildConnection();
    const result = await probeConnectionReachability(connection, {
      buildClient: () => buildClientForFixture(undefined),
    });

    expect(result.reachable).toBe(false);
    expect(result.detail).toMatch(/probe request failed/);
  });

  it("fails informatively against an unreachable connection", async () => {
    const connection = buildConnection({ baseUrl: "https://127.0.0.1:1" });
    const result = await probeConnectionReachability(connection, {
      buildClient: () =>
        new GatewayHttpClient({
          allowlist: { allowedSchemes: ["https:"], allowedOrigins: ["https://127.0.0.1:1"] },
          resolveHostAddresses: async () => ["203.0.113.7"],
          sendRequest: realNetworkSendRequestPinnedTo("127.0.0.1"),
        }),
    });

    expect(result.reachable).toBe(false);
    expect(result.detail).toMatch(/probe request failed/);
  });

  it("fails informatively when the secret cannot be resolved", async () => {
    delete process.env.EO_GATEWAY_DOCTOR_TEST_SECRET;
    const connection = buildConnection();
    const result = await probeConnectionReachability(connection);
    expect(result.reachable).toBe(false);
    expect(result.detail).toMatch(/secret resolution failed/);
  });

  it("uses the default client builder (no override) and is refused by the real SSRF guard for a loopback target without a custom CA", async () => {
    const connection = buildConnection();
    const result = await probeConnectionReachability(connection);
    expect(result.reachable).toBe(false);
    expect(result.detail).toMatch(/refused/);
  });

  it("uses the default client builder (no override) with a custom CA and is still refused by the real SSRF guard for a loopback target", async () => {
    const caPath = join(dir, "ca-default-builder.pem");
    await writeFile(caPath, cert.certPem);
    await chmod(caPath, 0o600);
    const connection = buildConnection({ customCaRef: { path: caPath } });
    const result = await probeConnectionReachability(connection);
    expect(result.reachable).toBe(false);
    expect(result.detail).toMatch(/refused/);
  });

  it("fails informatively when the custom CA file cannot be read", async () => {
    const connection = buildConnection({ customCaRef: { path: join(dir, "does-not-exist.pem") } });
    const result = await probeConnectionReachability(connection);
    expect(result.reachable).toBe(false);
    expect(result.detail).toMatch(/custom CA read failed/);
  });

  it("reports reachable:false for a 5xx response", async () => {
    const errorServer = createServer({ key: cert.keyPem, cert: cert.certPem }, (_req, res) => {
      res.writeHead(503);
      res.end("unavailable");
    });
    const errorPort = await listen(errorServer);
    try {
      const caPath = join(dir, "ca-for-503.pem");
      await writeFile(caPath, cert.certPem);
      await chmod(caPath, 0o600);
      const connection = buildConnection({
        baseUrl: `https://127.0.0.1:${errorPort}`,
        customCaRef: { path: caPath },
      });
      const result = await probeConnectionReachability(connection, {
        buildClient: (_c, customCaPem) =>
          new GatewayHttpClient({
            allowlist: {
              allowedSchemes: ["https:"],
              allowedOrigins: [`https://127.0.0.1:${errorPort}`],
            },
            resolveHostAddresses: async () => ["203.0.113.7"],
            sendRequest: realNetworkSendRequestPinnedTo("127.0.0.1"),
            maxAttempts: 1,
            ...(customCaPem !== undefined ? { customCaPem } : {}),
          }),
      });
      expect(result.reachable).toBe(false);
      expect(result.status).toBe(503);
    } finally {
      await close(errorServer);
    }
  });
});
