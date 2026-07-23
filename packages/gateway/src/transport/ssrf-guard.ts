/**
 * SSRF guard — roadmap/16-gateway-core.md §In scope, "Transport security":
 * "scheme/origin/IP-range allowlists (SSRF guard incl. private ranges +
 * DNS pinning)... redirect revalidation before credentials attach." Work
 * item 2.
 *
 * Pure decision functions over already-resolved data (URL + resolved IP
 * addresses) — no network I/O of its own. `../http-client.ts` is the one
 * caller that performs the actual DNS resolution and redirect-following,
 * consulting this module at each hop before credentials are attached.
 */

export type SsrfGuardVerdict =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

const PRIVATE_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. cloud metadata endpoint 169.254.169.254
  ["0.0.0.0", 8],
];

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return undefined;
    value = (value << 8) + n;
  }
  return value >>> 0;
}

/** True when `ip` (IPv4 dotted-quad) falls inside `cidr` (`base/prefixLength`). */
function inCidr(ip: string, base: string, prefixLength: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === undefined || baseInt === undefined) return false;
  if (prefixLength === 0) return true;
  const mask = (~0 << (32 - prefixLength)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** Converts two IPv6 hex groups (16 bits each) into the 4 IPv4 octets they jointly encode. */
function ipv6HexGroupsToIpv4(hi: string, lo: string): string | undefined {
  const hiNum = Number.parseInt(hi, 16);
  const loNum = Number.parseInt(lo, 16);
  if (!Number.isFinite(hiNum) || !Number.isFinite(loNum)) return undefined;
  if (hiNum < 0 || hiNum > 0xffff || loNum < 0 || loNum > 0xffff) return undefined;
  return `${(hiNum >> 8) & 0xff}.${hiNum & 0xff}.${(loNum >> 8) & 0xff}.${loNum & 0xff}`;
}

/**
 * MEDIUM #4 (adversarial-review fix): extracts an embedded IPv4 address
 * from an IPv6 literal, if one is present — IPv4-mapped (`::ffff:x.x.x.x`
 * or the hex-group form `::ffff:hhhh:llll`), the deprecated IPv4-
 * compatible form (`::x.x.x.x`), and NAT64-embedded addresses
 * (`64:ff9b::x.x.x.x` or `64:ff9b::hhhh:llll`) all smuggle a real IPv4
 * address (which may itself be private/reserved, e.g. the cloud metadata
 * endpoint `169.254.169.254`) inside an address whose own top-level form
 * looks like ordinary, unclassified IPv6. Returns `undefined` when `ip`
 * carries no such embedding (an ordinary IPv6 address).
 */
function extractEmbeddedIpv4(ip: string): string | undefined {
  // Dotted-quad suffix forms: ::ffff:1.2.3.4, ::1.2.3.4, 64:ff9b::1.2.3.4 —
  // a dotted-decimal suffix is syntactically valid in IPv6 text form only
  // for these embedding conventions, never for an ordinary IPv6 address.
  const dottedMatch = /(?:^|:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip);
  if (dottedMatch?.[1] !== undefined) {
    return dottedMatch[1];
  }

  // Hex-group suffix forms: ::ffff:a9fe:a9fe (IPv4-mapped), 64:ff9b::a9fe:a9fe (NAT64) —
  // the last two 16-bit hex groups jointly encode the 4 IPv4 octets.
  const hexMatch = /^(?:::ffff:0:|::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hexMatch?.[1] !== undefined && hexMatch[2] !== undefined) {
    return ipv6HexGroupsToIpv4(hexMatch[1], hexMatch[2]);
  }

  return undefined;
}

/** True for any IPv4 private/loopback/link-local/unspecified range, any IPv6 loopback/unique-local/link-local literal, and any IPv6 address that embeds a private/reserved IPv4 address (IPv4-mapped, IPv4-compatible, or NAT64 — MEDIUM #4). */
export function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.trim().toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // IPv6 unique local
  if (normalized.startsWith("fe80:")) return true; // IPv6 link-local
  if (normalized.includes(":")) {
    const embedded = extractEmbeddedIpv4(normalized);
    if (embedded !== undefined) {
      return isPrivateOrReservedIp(embedded); // re-run the IPv4 check against the smuggled address
    }
    return false; // other IPv6, no embedded IPv4: not classified private by this guard
  }

  return PRIVATE_IPV4_RANGES.some(([base, prefix]) => inCidr(normalized, base, prefix));
}

export interface SsrfAllowlist {
  readonly allowedSchemes: readonly string[]; // e.g. ["https:"]
  readonly allowedOrigins: readonly string[]; // exact origin strings, e.g. "https://example.atlassian.net"
}

/** Validates a target URL's scheme + origin against an explicit allowlist — never a wildcard/prefix match. */
export function checkOriginAllowlist(target: URL, allowlist: SsrfAllowlist): SsrfGuardVerdict {
  if (!allowlist.allowedSchemes.includes(target.protocol)) {
    return { allowed: false, reason: `scheme "${target.protocol}" is not allowlisted` };
  }
  if (!allowlist.allowedOrigins.includes(target.origin)) {
    return { allowed: false, reason: `origin "${target.origin}" is not allowlisted` };
  }
  return { allowed: true };
}

/** Validates a resolved IP address is not in a private/reserved range. */
export function checkResolvedAddress(ip: string): SsrfGuardVerdict {
  if (isPrivateOrReservedIp(ip)) {
    return { allowed: false, reason: `resolved address "${ip}" is a private/reserved range` };
  }
  return { allowed: true };
}

/**
 * Full pre-credential-attach check for one hop (initial request or a
 * redirect target): origin allowlist AND every resolved address must both
 * pass. `resolvedAddresses` is supplied by the caller (DNS-pinning: the
 * same resolved set that will actually be dialed, not re-resolved later —
 * see 16 §In scope, "DNS pinning").
 */
export function checkHopBeforeCredentialAttach(
  target: URL,
  resolvedAddresses: readonly string[],
  allowlist: SsrfAllowlist,
): SsrfGuardVerdict {
  const originVerdict = checkOriginAllowlist(target, allowlist);
  if (!originVerdict.allowed) return originVerdict;

  if (resolvedAddresses.length === 0) {
    return { allowed: false, reason: "no resolved addresses supplied for this hop" };
  }

  for (const ip of resolvedAddresses) {
    const verdict = checkResolvedAddress(ip);
    if (!verdict.allowed) return verdict;
  }
  return { allowed: true };
}
