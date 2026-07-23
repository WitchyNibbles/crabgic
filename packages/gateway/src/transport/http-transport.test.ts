import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import {
  createServer as createHttpsServer,
  Agent as HttpsAgent,
  type Server as HttpsServer,
} from "node:https";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sendHttpRequest } from "./http-transport.js";
import { generateSelfSignedCert, type DisposableCert } from "./test-support/self-signed-cert.js";

function listen(server: HttpServer | HttpsServer): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("expected an AddressInfo");
      }
      resolve(address.port);
    });
  });
}

function close(server: HttpServer | HttpsServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("sendHttpRequest — plain HTTP", () => {
  let server: HttpServer;
  let port: number;

  beforeAll(async () => {
    server = createHttpServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "https://example.com/target" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hello from fixture server");
    });
    port = await listen(server);
  });

  afterAll(async () => {
    await close(server);
  });

  it("performs a GET and returns status/headers/body", async () => {
    const res = await sendHttpRequest({ url: new URL(`http://127.0.0.1:${port}/`), method: "GET" });
    expect(res.status).toBe(200);
    expect(res.bodyText).toBe("hello from fixture server");
    expect(res.headers["content-type"]).toBe("text/plain");
  });

  it("does not follow a redirect itself — reports the 3xx + location verbatim", async () => {
    const res = await sendHttpRequest({
      url: new URL(`http://127.0.0.1:${port}/redirect`),
      method: "GET",
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://example.com/target");
  });

  it("sends a request body for a POST", async () => {
    let received = "";
    const echoServer = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      req.on("end", () => {
        received = body;
        res.writeHead(200);
        res.end("ok");
      });
    });
    const echoPort = await listen(echoServer);
    try {
      await sendHttpRequest({
        url: new URL(`http://127.0.0.1:${echoPort}/`),
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      });
      expect(received).toBe(JSON.stringify({ hello: "world" }));
    } finally {
      await close(echoServer);
    }
  });

  it("rejects when the target is unreachable", async () => {
    await expect(
      sendHttpRequest({ url: new URL("http://127.0.0.1:1"), method: "GET", timeoutMs: 500 }),
    ).rejects.toThrow();
  });
});

describe("sendHttpRequest — HTTPS custom CA", () => {
  let cert: DisposableCert;
  let server: HttpsServer;
  let port: number;

  beforeAll(async () => {
    cert = await generateSelfSignedCert();
    server = createHttpsServer({ key: cert.keyPem, cert: cert.certPem }, (_req, res) => {
      res.writeHead(200);
      res.end("secure hello");
    });
    port = await listen(server);
  });

  afterAll(async () => {
    await close(server);
    await cert.cleanup();
  });

  it("succeeds when the custom CA is supplied", async () => {
    const agent = new HttpsAgent({ ca: cert.certPem });
    const res = await sendHttpRequest({
      url: new URL(`https://127.0.0.1:${port}/`),
      method: "GET",
      httpsAgent: agent,
    });
    expect(res.status).toBe(200);
    expect(res.bodyText).toBe("secure hello");
    agent.destroy();
  });

  it("fails when no custom CA is supplied (self-signed cert is untrusted)", async () => {
    const agent = new HttpsAgent();
    await expect(
      sendHttpRequest({
        url: new URL(`https://127.0.0.1:${port}/`),
        method: "GET",
        httpsAgent: agent,
      }),
    ).rejects.toThrow();
    agent.destroy();
  });

  it("HTTPS + custom CA still validates via SNI when pinned (hostname in URL matches the cert's SAN, dial target is the pinned IP)", async () => {
    const agent = new HttpsAgent({ ca: cert.certPem });
    const res = await sendHttpRequest({
      url: new URL(`https://localhost:${port}/`),
      method: "GET",
      httpsAgent: agent,
      pinnedAddress: "127.0.0.1",
    });
    expect(res.status).toBe(200);
    expect(res.bodyText).toBe("secure hello");
    agent.destroy();
  });
});

describe("sendHttpRequest — DNS pinning (HIGH #1 adversarial-review fix)", () => {
  let server: HttpServer;
  let port: number;
  let observedHost: string | undefined;

  beforeAll(async () => {
    server = createHttpServer((req, res) => {
      observedHost = req.headers.host;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("pinned hello");
    });
    port = await listen(server);
  });

  afterAll(async () => {
    await close(server);
  });

  it("dials the pinned address literally, never re-resolving the (unresolvable) hostname at connect time", async () => {
    // "eo-gateway-test-unresolvable.invalid" is not a real, resolvable
    // hostname — if `sendHttpRequest` fell back to resolving it via real
    // DNS at connect() time (the rebinding TOCTOU this fix closes), this
    // request would fail with ENOTFOUND. It succeeds only because the
    // literal `pinnedAddress` is what actually gets dialed.
    const res = await sendHttpRequest({
      url: new URL(`http://eo-gateway-test-unresolvable.invalid:${port}/`),
      method: "GET",
      pinnedAddress: "127.0.0.1",
    });
    expect(res.status).toBe(200);
    expect(res.bodyText).toBe("pinned hello");
  });

  it("preserves the original hostname as the Host header while dialing the pinned IP", async () => {
    observedHost = undefined;
    await sendHttpRequest({
      url: new URL(`http://eo-gateway-test-unresolvable.invalid:${port}/`),
      method: "GET",
      pinnedAddress: "127.0.0.1",
    });
    expect(observedHost).toBe(`eo-gateway-test-unresolvable.invalid:${port}`);
  });
});
