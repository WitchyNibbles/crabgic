/**
 * DNS resolution for SSRF-guard pinning — roadmap/16-gateway-core.md §In
 * scope, "Transport security": "SSRF guard incl. private ranges + DNS
 * pinning." Work item 2.
 *
 * A thin wrapper over `node:dns/promises` `lookup(..., { all: true })` so
 * `../transport/http-client.ts` and its tests can inject a fake resolver
 * (no real DNS lookups needed in unit tests) while production code uses
 * the real resolver by default.
 */

import { lookup } from "node:dns/promises";

export type ResolveHostAddresses = (hostname: string) => Promise<readonly string[]>;

/** Real resolver: every A/AAAA address `hostname` currently resolves to. */
export const resolveHostAddressesViaDns: ResolveHostAddresses = async (hostname) => {
  // An IP literal resolves to itself — no DNS round-trip needed, and
  // importantly this is what makes an SSRF attempt via a raw IP literal
  // (as opposed to a rebinding domain) visible to the same check.
  if (/^[0-9.]+$/.test(hostname) || hostname.includes(":")) {
    return [hostname];
  }
  const results = await lookup(hostname, { all: true });
  return results.map((r) => r.address);
};
