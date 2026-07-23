/**
 * Fake-provider testkit — roadmap/16-gateway-core.md §In scope, work item
 * 6: "scriptable tracker + observability doubles with fault injection
 * (429/401/409/412, malformed pages, mid-POST timeouts) — extended, not
 * reimplemented, by 18/19/20's own fault matrices."
 *
 * A scriptable `sendHttpRequest`-compatible fake — plugs directly into
 * `../transport/http-client.js`'s `sendRequest` injection point, so a fake
 * provider is exercised through this phase's REAL transport stack (SSRF
 * preflight, retry ladder, backoff, budgets), not a bespoke shortcut that
 * bypasses it. 18/19/20 extend this by scripting their own response
 * sequences against their own resource shapes, never reimplementing the
 * scripting mechanism itself.
 */

import type { HttpTransportRequest, HttpTransportResponse } from "../transport/http-transport.js";

export interface FakeProviderScriptEntry {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly bodyText?: string;
  /** Simulates a mid-request fault (e.g. a mid-POST timeout) — the fake transport rejects instead of resolving. */
  readonly fault?: string;
}

export interface FakeProviderScript {
  /** Consumed one entry per call, in order; the last entry repeats once the script is exhausted (a steady-state tail, e.g. "then 200 OK forever"). */
  readonly responses: readonly FakeProviderScriptEntry[];
}

export interface FakeProviderCallRecord {
  readonly method: string;
  readonly url: string;
}

/**
 * Builds a `sendHttpRequest`-compatible fake driven by `script`. Records
 * every call it observes (`calls`) so a test can assert call counts (e.g.
 * "never re-applied a blind retry for POST").
 */
export function createFakeProviderTransport(script: FakeProviderScript): {
  readonly send: (req: HttpTransportRequest) => Promise<HttpTransportResponse>;
  readonly calls: readonly FakeProviderCallRecord[];
} {
  const calls: FakeProviderCallRecord[] = [];
  let index = 0;

  const send = async (req: HttpTransportRequest): Promise<HttpTransportResponse> => {
    calls.push({ method: req.method, url: req.url.toString() });
    const entry = script.responses[Math.min(index, script.responses.length - 1)];
    index += 1;
    if (entry === undefined) {
      throw new Error("createFakeProviderTransport: empty script");
    }
    if (entry.fault !== undefined) {
      throw new Error(`fake provider transport: simulated fault "${entry.fault}"`);
    }
    return {
      status: entry.status,
      headers: entry.headers ?? {},
      bodyText: entry.bodyText ?? "",
    };
  };

  return { send, calls };
}
