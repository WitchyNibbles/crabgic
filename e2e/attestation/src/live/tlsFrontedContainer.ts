import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
/** `node:net`'s base `Server` — both `http.Server` and `https.Server` extend it, so the bind helpers below work for the throwaway upstreams their unit tests build as well as for the real terminator. */
import type { Server } from "node:net";
import { sendHttpRequest, type HttpTransportRequest } from "@eo/gateway";
import { generateSelfSignedCert, type DisposableCert } from "./selfSignedCert.js";

/**
 * A TLS terminator in front of a containerized plain-HTTP service, plus the
 * TWO transport seams needed to reach it through the real, unmodified
 * gateway stack.
 *
 * WHY TWO SEAMS AND NOT ONE. `GatewayHttpClient` resolves the hostname,
 * SSRF-validates every returned address, then dials `addresses[0]` as a
 * PINNED address (`transport/http-client.ts:203-221`, `:152-157`) — that is
 * the whole point of the DNS-pinning fix. So overriding
 * `resolveHostAddresses` ALONE does not reach the container: the client
 * would faithfully dial `203.0.113.60`. The established repo pattern
 * (`packages/connectors-jira/src/testkit/custom-ca-self-signed.integration.
 * test.ts:99-100`, `packages/gateway/src/connection-doctor/reachability-
 * probe.test.ts`, `e2e/matrix/connector/src/connector-security/
 * ssrf-and-dns-rebind.test.ts`) pairs it with `sendHttpRequest`'s own
 * `pinnedAddress`, so the guard's preflight sees a routable, non-blocked
 * answer while the real dial lands on loopback.
 *
 * NO PRODUCTION CONTROL IS RELAXED. `ssrf-guard.ts` blocks exactly
 * `10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0.0.0.0/8`;
 * `203.0.113.0/24` is TEST-NET-3 and is not among them, so the guard passes
 * on its own terms. Neither `ssrf-guard.ts` nor `external-connection.ts`'s
 * `https://` refinement is modified anywhere in this work package — the
 * `https://127.0.0.1:<port>` base URL is representable, and is exactly what
 * the precedent test uses.
 *
 * THE SEAM VALUES ARE EXPORTED AS CONSTANTS so the emitted evidence artifact
 * records the very same literals the run used, rather than a prose
 * description that could drift from them.
 */

/** The fake, non-loopback answer the SSRF-guard preflight sees. TEST-NET-3 (RFC 5737) — reserved for documentation, never routed, and NOT in `ssrf-guard.ts`'s blocked set. */
export const SEAM_RESOLVED_ADDRESS = "203.0.113.60";

/** Where the socket actually lands. */
export const SEAM_PINNED_DIAL_ADDRESS = "127.0.0.1";

export const SEAM_TLS_TERMINATION_DESCRIPTION =
  "in-process Node HTTPS terminator fronting the container's plain-HTTP port, disposable " +
  "self-signed CA supplied to the connection as customCaRef";

/** The real-network sender, pinned to the disposable local terminator — verbatim the precedent test's helper. */
export function realNetworkSendRequestPinnedTo(pinnedAddress: string): typeof sendHttpRequest {
  return (req: HttpTransportRequest) => sendHttpRequest({ ...req, pinnedAddress });
}

export interface TlsFront {
  /** `https://127.0.0.1:<port>` — a legal `ExternalConnection.baseUrl`. */
  readonly baseUrl: string;
  readonly certPath: string;
  readonly certPem: string;
  close(): Promise<void>;
}

/** The port a bound server actually got. Throws rather than guessing: `null` means "not bound yet", a string means a pipe/unix socket, and neither has a port this harness could use. */
export function portFromAddress(address: ReturnType<Server["address"]>): number {
  if (address === null || typeof address === "string") {
    throw new Error(
      `expected an AddressInfo from the TLS terminator, got ${address === null ? "null (not bound)" : `a pipe/unix-socket address (${address})`}`,
    );
  }
  return address.port;
}

/** Binds `server` to an ephemeral port and resolves with it; REJECTS on a bind error rather than leaving the caller hanging on a listen callback that never fires. Exported so the failure path is testable without a container. */
export function listenOnLoopback(
  server: Server,
  host: string = SEAM_PINNED_DIAL_ADDRESS,
): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      try {
        resolve(portFromAddress(server.address()));
      } catch (err) {
        // `portFromAddress` throws `Error` and nothing else; its own two
        // refusal branches are unit-tested directly rather than through here.
        reject(err as Error);
      }
    });
  });
}

/**
 * Starts an HTTPS terminator on an ephemeral loopback port that byte-forwards
 * to `http://127.0.0.1:<upstreamPort>`. It adds no semantics of its own: every
 * status, header and body below is the container's.
 */
export async function startTlsFront(upstreamPort: number): Promise<TlsFront> {
  const cert: DisposableCert = await generateSelfSignedCert();
  const server = createHttpsServer({ key: cert.keyPem, cert: cert.certPem }, (req, res) => {
    const upstream = httpRequest(
      {
        host: SEAM_PINNED_DIAL_ADDRESS,
        port: upstreamPort,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `${SEAM_PINNED_DIAL_ADDRESS}:${upstreamPort}` },
      },
      (upstreamResponse) => {
        res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  const port = await listenOnLoopback(server);

  return {
    baseUrl: `https://${SEAM_PINNED_DIAL_ADDRESS}:${port}`,
    certPath: cert.certPath,
    certPem: cert.certPem,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await cert.cleanup();
    },
  };
}
