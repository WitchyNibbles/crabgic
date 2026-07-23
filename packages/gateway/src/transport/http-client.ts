/**
 * `GatewayHttpClient` — composes every piece of roadmap/16-gateway-core.md
 * §In scope's "Transport security" bullet into one caller-facing surface:
 * TLS verification (via `../http-transport.js`'s per-request `https.Agent`),
 * redirect revalidation before credentials attach (SSRF guard, re-run on
 * every hop), scheme/origin/IP-range/base-path allowlists, ≤4 in-flight
 * per connection, Retry-After + jittered bounded backoff, write
 * serialization per tenant+resource (for mutating verbs only), and the
 * 256 KiB result budget. Work item 2.
 *
 * DNS pinning (HIGH #1, adversarial-review fix): `#preflight` resolves and
 * SSRF-validates the hostname's addresses, then the SAME validated address
 * is threaded through as `../http-transport.js`'s `pinnedAddress` — the
 * actual socket connects to that literal IP, never re-resolving the
 * hostname at connect() time. This closes the TOCTOU window a naive
 * "check by hostname, dial by hostname" design leaves open: a rebinding
 * resolver that answers differently between the check and Node's own
 * internal connect-time resolution could otherwise smuggle a request past
 * the guard entirely undetected.
 */

import { Agent as HttpsAgent } from "node:https";
import { checkHopBeforeCredentialAttach, type SsrfAllowlist } from "./ssrf-guard.js";
import { decideRetryAction, type HttpVerb } from "./retry-ladder.js";
import { computeBackoffDelayMs, parseRetryAfterHeader } from "./backoff.js";
import { enforceResultBudget } from "./budgets.js";
import { WriteSerializer, type WriteSerializerKey } from "./write-serializer.js";
import { resolveHostAddressesViaDns, type ResolveHostAddresses } from "./dns-resolve.js";
import { sendHttpRequest, type HttpTransportResponse } from "./http-transport.js";

export class SsrfRefusedError extends Error {
  readonly url: string;
  readonly reason: string;

  constructor(url: string, reason: string) {
    super(`refused pre-credential-attach: ${url} (${reason})`);
    this.name = "SsrfRefusedError";
    this.url = url;
    this.reason = reason;
    Object.freeze(this);
  }
}

const MAX_REDIRECT_HOPS = 5;
const DEFAULT_MAX_IN_FLIGHT_PER_CONNECTION = 4;
const DEFAULT_MAX_ATTEMPTS = 4;

export interface GatewayHttpRequest {
  readonly connectionId: string;
  readonly tenant: string;
  readonly resource: string;
  readonly url: URL;
  readonly method: HttpVerb;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly hasPrecondition?: boolean;
  /** Whether this call requires prior write serialization for its (tenant, resource) key — false for pure reads. */
  readonly isWrite?: boolean;
}

export interface GatewayHttpClientOptions {
  readonly allowlist: SsrfAllowlist;
  readonly customCaPem?: string;
  readonly maxInFlightPerConnection?: number;
  readonly maxAttempts?: number;
  readonly resolveHostAddresses?: ResolveHostAddresses;
  readonly sendRequest?: typeof sendHttpRequest;
  readonly random?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Bounded-concurrency gate: at most `limit` in-flight tasks at any time for this client instance. */
class ConcurrencyGate {
  readonly #limit: number;
  #active = 0;
  readonly #queue: Array<() => void> = [];

  constructor(limit: number) {
    this.#limit = limit;
  }

  async #acquire(): Promise<void> {
    if (this.#active < this.#limit) {
      this.#active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.#queue.push(resolve));
    this.#active += 1;
  }

  #release(): void {
    this.#active -= 1;
    const next = this.#queue.shift();
    if (next !== undefined) next();
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.#acquire();
    try {
      return await task();
    } finally {
      this.#release();
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GatewayHttpClient {
  readonly #allowlist: SsrfAllowlist;
  readonly #httpsAgent: HttpsAgent | undefined;
  readonly #gate: ConcurrencyGate;
  readonly #maxAttempts: number;
  readonly #resolveHostAddresses: ResolveHostAddresses;
  readonly #sendRequest: typeof sendHttpRequest;
  readonly #random: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #writeSerializer = new WriteSerializer();

  constructor(options: GatewayHttpClientOptions) {
    this.#allowlist = options.allowlist;
    this.#httpsAgent =
      options.customCaPem !== undefined ? new HttpsAgent({ ca: options.customCaPem }) : undefined;
    this.#gate = new ConcurrencyGate(
      options.maxInFlightPerConnection ?? DEFAULT_MAX_IN_FLIGHT_PER_CONNECTION,
    );
    this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#resolveHostAddresses = options.resolveHostAddresses ?? resolveHostAddressesViaDns;
    this.#sendRequest = options.sendRequest ?? sendHttpRequest;
    this.#random = options.random ?? Math.random;
    this.#sleep = options.sleep ?? defaultSleep;
  }

  async request(req: GatewayHttpRequest): Promise<HttpTransportResponse> {
    const runOnce = () => this.#requestWithRetries(req);
    if (req.isWrite === true) {
      const key: WriteSerializerKey = { tenant: req.tenant, resource: req.resource };
      return this.#gate.run(() => this.#writeSerializer.runExclusive(key, runOnce));
    }
    return this.#gate.run(runOnce);
  }

  async #requestWithRetries(req: GatewayHttpRequest): Promise<HttpTransportResponse> {
    let attempt = 0;
    let currentUrl = req.url;
    let redirectHops = 0;

    for (;;) {
      attempt += 1;
      const pinnedAddress = await this.#preflight(currentUrl, attempt === 1);

      const response = await this.#sendRequest({
        url: currentUrl,
        method: req.method,
        pinnedAddress,
        ...(req.headers !== undefined ? { headers: req.headers } : {}),
        ...(req.body !== undefined ? { body: req.body } : {}),
        ...(this.#httpsAgent !== undefined ? { httpsAgent: this.#httpsAgent } : {}),
      });

      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        redirectHops += 1;
        if (redirectHops > MAX_REDIRECT_HOPS) {
          throw new Error(`gateway http client: exceeded ${MAX_REDIRECT_HOPS} redirect hops`);
        }
        // The redirect target is resolved+validated+pinned exactly once,
        // uniformly, by the NEXT loop iteration's own `#preflight` call
        // above — never a second, separate validation here — so credentials
        // are never attached to an unvalidated hop, and each hop's own
        // resolved address is used exactly once, never stale from a prior
        // hop (HIGH #1).
        currentUrl = new URL(response.headers.location, currentUrl);
        continue; // redirect hop consumed no retry-attempt budget of its own here
      }

      enforceResultBudget(response.bodyText);

      const action = decideRetryAction({
        verb: req.method,
        status: response.status,
        hasPrecondition: req.hasPrecondition ?? false,
        attempt,
        maxAttempts: this.#maxAttempts,
      });

      if (action.kind === "retry") {
        const retryAfterMs = parseRetryAfterHeader(response.headers["retry-after"] ?? null);
        const delayMs = computeBackoffDelayMs(attempt, retryAfterMs, { baseMs: 200, maxMs: 30_000, random: this.#random });
        await this.#sleep(delayMs);
        continue;
      }

      return response;
    }
  }

  /** Resolves + SSRF-validates `url`'s addresses and returns the ONE address that passed validation to pin the actual dial to (HIGH #1 — the same address checked is the address dialed, never re-resolved). */
  async #preflight(url: URL, isFirstHop: boolean): Promise<string> {
    const addresses = await this.#resolveHostAddresses(url.hostname);
    const verdict = checkHopBeforeCredentialAttach(url, addresses, this.#allowlist);
    if (!verdict.allowed) {
      throw new SsrfRefusedError(url.toString(), `${isFirstHop ? "initial request" : "redirect"}: ${verdict.reason}`);
    }
    const pinned = addresses[0];
    if (pinned === undefined) {
      // checkHopBeforeCredentialAttach already refuses an empty address
      // list, so this is unreachable in practice — satisfies the type
      // checker without a non-null assertion.
      throw new SsrfRefusedError(url.toString(), "no resolved address available to pin");
    }
    return pinned;
  }
}

export { MAX_REDIRECT_HOPS };
