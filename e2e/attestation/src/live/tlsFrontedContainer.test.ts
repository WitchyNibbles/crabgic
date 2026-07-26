import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { Agent } from "node:https";
import { afterEach, describe, expect, it } from "vitest";
import { checkResolvedAddress, sendHttpRequest } from "@crabgic/gateway";
import {
  SEAM_PINNED_DIAL_ADDRESS,
  SEAM_RESOLVED_ADDRESS,
  listenOnLoopback,
  portFromAddress,
  realNetworkSendRequestPinnedTo,
  startTlsFront,
  type TlsFront,
} from "./tlsFrontedContainer.js";

/**
 * Unit coverage for the TLS-fronting helper WITHOUT a Docker daemon
 * (adversarial-validation MINOR-6: `src/live/**` shipped ~380 lines with zero
 * unit tests). The container is irrelevant to every branch below — the front
 * byte-forwards to whatever plain-HTTP upstream port it is handed, so a
 * throwaway `node:http` server on loopback exercises exactly the code the
 * containerized run does, including the 502 upstream-error path and the
 * `listen()` reject path that the happy-path `@live` suite never reaches.
 *
 * `openssl` is required (as it already is by
 * `packages/gateway/src/transport/http-transport.test.ts`, a default-suite
 * test), not a Docker daemon.
 */

const openFronts: TlsFront[] = [];
const openServers: HttpServer[] = [];

afterEach(async () => {
  for (const front of openFronts.splice(0)) await front.close();
  for (const server of openServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function startUpstream(status: number, body: string): Promise<number> {
  const server = createHttpServer((_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body);
  });
  openServers.push(server);
  return listenOnLoopback(server);
}

async function front(upstreamPort: number): Promise<TlsFront> {
  const started = await startTlsFront(upstreamPort);
  openFronts.push(started);
  return started;
}

/** A loopback port with nothing listening on it: bound to learn the number, then closed. */
async function deadPort(): Promise<number> {
  const probe = createNetServer();
  const port = await new Promise<number>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, SEAM_PINNED_DIAL_ADDRESS, () => resolve(portFromAddress(probe.address())));
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/**
 * The seam constants are load-bearing for the whole "no production control is
 * relaxed" argument AND are copied verbatim into the committed evidence
 * artifact. Pinned to their literals here, and — more importantly — checked
 * against the REAL, unmodified `ssrf-guard`, so the claim "TEST-NET-3 is not
 * in the blocked set, so the guard passed on its own terms" is verified rather
 * than asserted in prose.
 */
describe("the address-resolution seam constants", () => {
  it("resolves to TEST-NET-3 and dials loopback", () => {
    expect(SEAM_RESOLVED_ADDRESS).toBe("203.0.113.60");
    expect(SEAM_PINNED_DIAL_ADDRESS).toBe("127.0.0.1");
  });

  it("is ALLOWED by the real ssrf-guard, which is why no guard needed changing", () => {
    expect(checkResolvedAddress(SEAM_RESOLVED_ADDRESS).allowed).toBe(true);
  });

  it("NEGATIVE CONTROL: the address actually dialled would have been blocked", () => {
    // Proves the guard is not simply permissive: loopback — the address the
    // socket really lands on — is refused by the same function.
    expect(checkResolvedAddress(SEAM_PINNED_DIAL_ADDRESS).allowed).toBe(false);
  });
});

describe("portFromAddress", () => {
  it("returns the bound port for a real AddressInfo", () => {
    expect(portFromAddress({ address: "127.0.0.1", family: "IPv4", port: 40404 })).toBe(40404);
  });

  it("throws rather than guessing when the server is not bound yet", () => {
    expect(() => portFromAddress(null)).toThrow(/AddressInfo/);
  });

  it("throws on a pipe/unix-socket address, which has no port at all", () => {
    expect(() => portFromAddress("/tmp/some.sock")).toThrow(/AddressInfo/);
  });
});

describe("listenOnLoopback", () => {
  it("binds an ephemeral loopback port and reports it", async () => {
    const server = createHttpServer();
    openServers.push(server);
    expect(await listenOnLoopback(server)).toBeGreaterThan(0);
  });

  it("REJECTS (never hangs) when the address cannot be bound", async () => {
    const server = createHttpServer();
    openServers.push(server);
    // TEST-NET-3 is assigned to no local interface, so bind() fails with
    // EADDRNOTAVAIL — the `server.once("error", reject)` path.
    await expect(listenOnLoopback(server, SEAM_RESOLVED_ADDRESS)).rejects.toThrow();
  });
});

describe("startTlsFront", () => {
  it("terminates TLS and byte-forwards the upstream's own status and body", async () => {
    const started = await front(await startUpstream(200, JSON.stringify({ database: "ok" })));

    const response = await sendHttpRequest({
      url: new URL(`${started.baseUrl}/api/health`),
      method: "GET",
      httpsAgent: new Agent({ ca: started.certPem }),
      pinnedAddress: SEAM_PINNED_DIAL_ADDRESS,
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.bodyText)).toEqual({ database: "ok" });
  });

  it("passes a non-2xx status through unchanged rather than inventing one", async () => {
    // The route-probe path depends on this: `probeRoute` reads `status < 400`,
    // so a front that normalized 404 to 200 would fabricate capabilities.
    const started = await front(await startUpstream(404, "{}"));

    const response = await sendHttpRequest({
      url: new URL(`${started.baseUrl}/apis/dashboard.grafana.app`),
      method: "GET",
      httpsAgent: new Agent({ ca: started.certPem }),
      pinnedAddress: SEAM_PINNED_DIAL_ADDRESS,
    });
    expect(response.status).toBe(404);
  });

  it("answers 502 when the upstream connection fails, instead of hanging the request", async () => {
    const started = await front(await deadPort());

    const response = await sendHttpRequest({
      url: new URL(`${started.baseUrl}/api/health`),
      method: "GET",
      httpsAgent: new Agent({ ca: started.certPem }),
      pinnedAddress: SEAM_PINNED_DIAL_ADDRESS,
    });
    expect(response.status).toBe(502);
  });
});

describe("realNetworkSendRequestPinnedTo", () => {
  /**
   * The whole point of the second seam. The URL names a hostname that
   * RESOLVES NOWHERE (`.invalid` is reserved by RFC 2606 precisely for this),
   * so the negative control below cannot connect at all — which is what makes
   * the positive case proof of pinning rather than of a lucky DNS answer.
   * TLS identity is deliberately not asserted here (the cert is issued for
   * localhost/127.0.0.1, not for the `.invalid` name); the other tests in this
   * file exercise the real, unmodified identity check.
   */
  const unpinnedAgent = () => new Agent({ rejectUnauthorized: false });

  it("dials the pinned address even when the URL hostname resolves nowhere", async () => {
    const started = await front(await startUpstream(200, '{"pinned":true}'));
    const port = new URL(started.baseUrl).port;

    const send = realNetworkSendRequestPinnedTo(SEAM_PINNED_DIAL_ADDRESS);
    const response = await send({
      url: new URL(`https://front.eo-attestation.invalid:${port}/api/health`),
      method: "GET",
      httpsAgent: unpinnedAgent(),
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.bodyText)).toEqual({ pinned: true });
  });

  it("NEGATIVE CONTROL: the identical request without the pin cannot connect", async () => {
    const started = await front(await startUpstream(200, '{"pinned":true}'));
    const port = new URL(started.baseUrl).port;

    await expect(
      sendHttpRequest({
        url: new URL(`https://front.eo-attestation.invalid:${port}/api/health`),
        method: "GET",
        httpsAgent: unpinnedAgent(),
      }),
    ).rejects.toThrow();
  });
});
