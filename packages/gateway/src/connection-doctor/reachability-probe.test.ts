import { createServer, type Server } from "node:https";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type ExternalConnection } from "@crabgic/contracts";
import { GatewayHttpClient } from "../transport/http-client.js";
import { sendHttpRequest, type HttpTransportRequest } from "../transport/http-transport.js";
import {
  generateSelfSignedCert,
  type DisposableCert,
} from "../transport/test-support/self-signed-cert.js";
import { buildDoctorProbeClient, probeConnectionReachability } from "./reachability-probe.js";

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
    process.env.CRABGIC_GATEWAY_DOCTOR_TEST_SECRET = "token-value";
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.CRABGIC_GATEWAY_DOCTOR_TEST_SECRET;
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
      secretRef: { backend: "env", variable: "CRABGIC_GATEWAY_DOCTOR_TEST_SECRET" },
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
    delete process.env.CRABGIC_GATEWAY_DOCTOR_TEST_SECRET;
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

  /**
   * Issue #135, defect 1b. The doctor built its client with an allowlist of
   * `[baseUrl.origin]` ALONE, while the connector path
   * (`buildAllowlistForConnection`) uses `[origin, ...allowedRedirectOrigins]`.
   * So `connection add --allow-redirect`, the one knob the CLI exposes for
   * a redirecting host, could not affect the check it most looks like it
   * should affect: the doctor refused a redirect the real call path allows.
   *
   * Asserted through the DEFAULT builder — injecting a client would test
   * the test's own allowlist, which is exactly what hid this for so long.
   */
  describe("the default client builder honors the connection's declared redirect origins", () => {
    // A SECOND fixture server on its own port — a genuinely different
    // origin, redirected to by the first, exactly as `<site>.atlassian.net`
    // redirects to `id.atlassian.com`. Nothing here is injected: the probe
    // builds its own client, so what is proven is the DEFAULT builder's
    // allowlist, which is where the defect lived.
    let redirectTarget: Server;
    let targetPort: number;
    let redirector: Server;
    let redirectorPort: number;

    beforeEach(async () => {
      redirectTarget = createServer({ key: cert.keyPem, cert: cert.certPem }, (_req, res) => {
        res.writeHead(200);
        res.end("landed");
      });
      targetPort = await listen(redirectTarget);
      redirector = createServer({ key: cert.keyPem, cert: cert.certPem }, (_req, res) => {
        res.writeHead(302, { location: `https://127.0.0.1:${targetPort}/landed` });
        res.end();
      });
      redirectorPort = await listen(redirector);
    });

    afterEach(async () => {
      await close(redirector);
      await close(redirectTarget);
    });

    async function probeAcrossRedirect(allowedRedirectOrigins: readonly string[]) {
      const caPath = join(dir, "ca-redirect.pem");
      await writeFile(caPath, cert.certPem);
      await chmod(caPath, 0o600);
      const connection = buildConnection({
        baseUrl: `https://127.0.0.1:${redirectorPort}`,
        allowedRedirectOrigins,
        customCaRef: { path: caPath },
      });
      // The PRODUCTION builder decides the allowlist — the thing under
      // test. Only DNS/dial are stood in for, as everywhere else in this
      // file, so a loopback fixture is reachable at all. Rebuilding the
      // allowlist here instead would assert the test against itself, which
      // is how this defect survived a green suite in the first place.
      return probeConnectionReachability(connection, {
        buildClient: (c, customCaPem) =>
          buildDoctorProbeClient(c, customCaPem, {
            resolveHostAddresses: async () => ["203.0.113.7"],
            sendRequest: realNetworkSendRequestPinnedTo("127.0.0.1"),
          }),
      });
    }

    it("refuses a redirect to an origin the connection never declared", async () => {
      const result = await probeAcrossRedirect([]);
      expect(result.reachable).toBe(false);
      expect(result.detail).toMatch(/refused/);
    });

    it("follows a redirect to an origin the connection DID declare", async () => {
      const result = await probeAcrossRedirect([`https://127.0.0.1:${targetPort}`]);
      expect(result.reachable).toBe(true);
      expect(result.status).toBe(200);
    });
  });

  /**
   * Issue #135, defect 1. `probeConnectionReachability` requested
   * `options.path ?? "/"`, and no production caller ever passed a path —
   * the seam existed but was dead. On Atlassian Cloud an unauthenticated
   * GET of the site root redirects to `id.atlassian.com`, so `connection
   * doctor` refused EVERY Jira Cloud connection at the SSRF guard before
   * reaching anything else.
   */
  describe("probe path", () => {
    it("requests the supplied path rather than the site root", async () => {
      const requested: string[] = [];
      const connection = buildConnection({ baseUrl: "https://jira.example.com" });
      await probeConnectionReachability(connection, {
        path: "/status",
        buildClient: () =>
          ({
            request: async (req: { url: URL }) => {
              requested.push(req.url.pathname);
              return { status: 200, headers: {}, bodyText: "" };
            },
          }) as unknown as GatewayHttpClient,
      });
      expect(requested).toEqual(["/status"]);
    });

    it("still defaults to the site root when no path is supplied", async () => {
      const requested: string[] = [];
      const connection = buildConnection({ baseUrl: "https://jira.example.com" });
      await probeConnectionReachability(connection, {
        buildClient: () =>
          ({
            request: async (req: { url: URL }) => {
              requested.push(req.url.pathname);
              return { status: 200, headers: {}, bodyText: "" };
            },
          }) as unknown as GatewayHttpClient,
      });
      expect(requested).toEqual(["/"]);
    });

    it("resolves the path against the base URL's own sub-path rather than replacing it", async () => {
      // A Data Center site is commonly served under a context path
      // (`https://host/jira`); a probe that dropped it would report on the
      // wrong service entirely.
      const requested: string[] = [];
      const connection = buildConnection({ baseUrl: "https://dc.example.com/jira/" });
      await probeConnectionReachability(connection, {
        path: "status",
        buildClient: () =>
          ({
            request: async (req: { url: URL }) => {
              requested.push(req.url.pathname);
              return { status: 200, headers: {}, bodyText: "" };
            },
          }) as unknown as GatewayHttpClient,
      });
      expect(requested).toEqual(["/jira/status"]);
    });
  });

  /**
   * Issue #135, adjacent note: "`probeConnectionReachability()` treats any
   * status < 500 as reachable, so a 404 from a wrong probe path still
   * reports success. Worth tightening if the path becomes provider-
   * specific." It now is provider-specific, so this is that tightening.
   */
  describe("a 404 at the probe path is not reachability", () => {
    async function probeWithStatus(status: number) {
      const connection = buildConnection({ baseUrl: "https://jira.example.com" });
      return probeConnectionReachability(connection, {
        path: "/status",
        buildClient: () =>
          ({
            request: async () => ({ status, headers: {}, bodyText: "" }),
          }) as unknown as GatewayHttpClient,
      });
    }

    it("reports UNREACHABLE and names the path, so the operator can see what was asked for", async () => {
      const result = await probeWithStatus(404);
      expect(result.reachable).toBe(false);
      expect(result.status).toBe(404);
      expect(result.detail).toContain("/status");
    });

    it("still treats an auth challenge as reachable — the probe attaches no credential", async () => {
      for (const status of [401, 403]) {
        const result = await probeWithStatus(status);
        expect(result.reachable).toBe(true);
      }
    });

    it("still treats a 200 as reachable", async () => {
      expect((await probeWithStatus(200)).reachable).toBe(true);
    });
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
