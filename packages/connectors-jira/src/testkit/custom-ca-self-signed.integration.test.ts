import { createServer, type Server } from "node:https";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GatewayHttpClient, sendHttpRequest, type HttpTransportRequest } from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import { z } from "zod";
import { resolveJiraDatacenterAuthHeaderProvider } from "../auth/jira-datacenter-auth.js";
import { JiraConnectionConfigSchema } from "../provider/jira-connection-config.js";
import {
  jiraDatacenterGetJson,
  type JiraDatacenterHttpContext,
} from "../resource-client/datacenter/jira-datacenter-http-context.js";
import { generateSelfSignedCert, type DisposableCert } from "./self-signed-cert.js";

/**
 * roadmap/19-jira-datacenter-adapter.md §Exit criteria: "Custom-CA/self-
 * signed connection succeeds against a disposable self-signed test
 * server, exercised library-level (16's transport invoked directly) —
 * integration test artifact." DC deployments are typically self-hosted
 * and often front Jira with a self-signed or internally-issued cert
 * (roadmap/19 §In scope, "Custom CA / self-hosted TLS": "exercised via
 * 16's gateway-level custom-CA path... no new TLS mechanism, only
 * DC-shaped fixtures against the existing path").
 *
 * Mirrors `@eo/gateway`'s own `reachability-probe.test.ts` pattern: the
 * SSRF-guard preflight is satisfied with a fake non-loopback
 * `resolveHostAddresses` answer, and the ACTUAL dial is pinned back to the
 * real disposable local server's loopback address via `sendHttpRequest`'s
 * `pinnedAddress` — exactly analogous to how a real deployment's own DNS
 * resolution would be trusted; only this test's stand-in resolver lies.
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

describe("Jira Data Center connection over a disposable self-signed HTTPS server", () => {
  let cert: DisposableCert;
  let server: Server;
  let port: number;

  beforeAll(async () => {
    cert = await generateSelfSignedCert();
    server = createServer({ key: cert.keyPem, cert: cert.certPem }, (req, res) => {
      if (req.headers["authorization"] !== "Bearer dc-pat-value") {
        res.writeHead(401);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ version: "10.3.1" }));
    });
    port = await listen(server);
  });

  afterAll(async () => {
    await close(server);
    await cert.cleanup();
  });

  beforeEach(() => {
    process.env.TEST_DC_SELFSIGNED_PAT = "dc-pat-value";
  });

  afterEach(() => {
    delete process.env.TEST_DC_SELFSIGNED_PAT;
  });

  it("succeeds end-to-end (custom-CA verified, PAT auth-header attached) — never falls back to an insecure/unverified connection", async () => {
    const baseUrl = `https://127.0.0.1:${port}`;
    const connection = buildExternalConnection({
      provider: "jira-datacenter",
      deploymentType: "datacenter",
      baseUrl,
    });
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: connection.id,
      deploymentType: "datacenter",
      authMode: "pat",
      patSecretRef: { backend: "env", variable: "TEST_DC_SELFSIGNED_PAT" },
    });
    const authHeaderProvider = resolveJiraDatacenterAuthHeaderProvider(config);

    const httpClient = new GatewayHttpClient({
      allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(baseUrl).origin] },
      customCaPem: cert.certPem,
      resolveHostAddresses: async () => ["203.0.113.60"], // fake, non-loopback (SSRF-guard preflight)
      sendRequest: realNetworkSendRequestPinnedTo("127.0.0.1"), // real dial, pinned to the disposable server
    });

    const ctx: JiraDatacenterHttpContext = { connection, httpClient, authHeaderProvider };
    const result = await jiraDatacenterGetJson(
      ctx,
      "/rest/api/2/serverInfo",
      z.object({ version: z.string() }),
      "serverInfo",
    );

    expect(result.version).toBe("10.3.1");
  });

  it("fails closed (never silently unauthenticated) when the PAT header is wrong", async () => {
    const baseUrl = `https://127.0.0.1:${port}`;
    const connection = buildExternalConnection({
      provider: "jira-datacenter",
      deploymentType: "datacenter",
      baseUrl,
    });
    const httpClient = new GatewayHttpClient({
      allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(baseUrl).origin] },
      customCaPem: cert.certPem,
      resolveHostAddresses: async () => ["203.0.113.61"],
      sendRequest: realNetworkSendRequestPinnedTo("127.0.0.1"),
    });
    const ctx: JiraDatacenterHttpContext = {
      connection,
      httpClient,
      authHeaderProvider: async () => ({ authorization: "Bearer wrong-token" }),
    };

    await expect(
      jiraDatacenterGetJson(
        ctx,
        "/rest/api/2/serverInfo",
        z.object({ version: z.string() }),
        "serverInfo",
      ),
    ).rejects.toMatchObject({ kind: "authentication" });
  });
});
