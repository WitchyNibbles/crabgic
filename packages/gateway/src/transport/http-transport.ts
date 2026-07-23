/**
 * Low-level HTTP(S) transport — roadmap/16-gateway-core.md §In scope,
 * "Transport security": "TLS verification... custom CA reference." Work
 * item 2.
 *
 * Deliberately built on Node core `node:https`/`node:http` (never the
 * global `fetch`): a per-request `https.Agent` is the only way to attach a
 * connection-specific custom CA bundle without a second HTTP client
 * dependency. `redirect` is always "manual" at this layer — this module
 * never follows a redirect itself; it reports a 3xx status + `location`
 * header back to the caller (`./http-client.ts`), which re-validates the
 * target through the SSRF guard before deciding whether to follow it.
 *
 * DNS pinning (HIGH #1, adversarial-review fix): when `pinnedAddress` is
 * supplied, the actual socket connects to that literal IP — never
 * re-resolving `url.hostname` via a fresh DNS lookup at connect() time.
 * Without this, `../http-client.ts`'s own SSRF-guard check (which
 * resolves and validates the hostname BEFORE this call) would be
 * defeated by a rebinding resolver that answers differently between the
 * check and Node's own internal connect-time resolution — a classic
 * check-then-use TOCTOU. The original hostname is preserved as the TLS
 * SNI `servername` (so certificate validation still checks the real
 * hostname, not the IP) and as the `Host` header (so virtual-hosted
 * origins still route correctly).
 */

import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest, type Agent as HttpsAgent } from "node:https";

export interface HttpTransportRequest {
  readonly url: URL;
  readonly method: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Custom CA / TLS options for this specific connection (e.g. a disposable self-signed test server). Ignored for `http:` targets. */
  readonly httpsAgent?: HttpsAgent;
  readonly timeoutMs?: number;
  /** The literal IP address to dial — see file-level "DNS pinning" doc comment. When omitted, falls back to dialing `url.hostname` directly (legacy/test-only path; production callers always supply this). */
  readonly pinnedAddress?: string;
}

export interface HttpTransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function flattenHeaders(raw: NodeJS.Dict<string | string[]>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    flat[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return flat;
}

/** Builds the `RequestOptions` for one call — pinned-address form dials the literal IP with SNI/Host set to the original hostname; the fallback form dials `url.hostname` directly (legacy/test-only). */
function buildRequestOptions(
  req: HttpTransportRequest,
  isHttps: boolean,
  timeoutMs: number,
): RequestOptions {
  const port = req.url.port !== "" ? Number(req.url.port) : isHttps ? 443 : 80;
  const path = `${req.url.pathname}${req.url.search}`;
  const base: RequestOptions = {
    method: req.method,
    headers: { ...req.headers },
    agent: isHttps ? req.httpsAgent : undefined,
    timeout: timeoutMs,
  };

  if (req.pinnedAddress === undefined) {
    return { ...base, hostname: req.url.hostname, port, path };
  }

  const hostHeaderValue =
    req.url.port !== "" ? `${req.url.hostname}:${req.url.port}` : req.url.hostname;
  return {
    ...base,
    hostname: req.pinnedAddress,
    port,
    path,
    headers: { ...base.headers, Host: hostHeaderValue },
    ...(isHttps ? { servername: req.url.hostname } : {}),
  };
}

/** Performs exactly one HTTP(S) request — no retries, no redirect-following. */
export async function sendHttpRequest(req: HttpTransportRequest): Promise<HttpTransportResponse> {
  const isHttps = req.url.protocol === "https:";
  const requestFn = isHttps ? httpsRequest : httpRequest;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const clientRequest = requestFn(buildRequestOptions(req, isHttps, timeoutMs), (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: flattenHeaders(res.headers),
          bodyText: Buffer.concat(chunks).toString("utf8"),
        });
      });
      res.on("error", (err) => reject(err));
    });

    clientRequest.on("timeout", () => {
      clientRequest.destroy(
        new Error(`request to ${req.url.origin} timed out after ${timeoutMs}ms`),
      );
    });
    clientRequest.on("error", (err) => reject(err));

    if (req.body !== undefined) {
      clientRequest.write(req.body);
    }
    clientRequest.end();
  });
}
