import { EnvelopeCompilationError } from "./compiler-error.js";

/**
 * `validateNetworkDestination` — phase-03 security-fix round, MINOR 4
 * (validator finding: `sandbox-profile.ts` copied
 * `envelope.networkDestinations` verbatim into `network.allowedDomains`;
 * `*`, `**`, `0.0.0.0/0`, `http://evil`, `evil.com:443` all passed
 * through unfiltered — if the sandbox proxy ever treats `*` as allow-all,
 * that is full egress).
 *
 * Network destinations are bare domain names (adaptation §4.2's own
 * schema example: `"allowedDomains": []` populated from plain hostnames
 * like `api.example.com`). This function REJECTS entries that are:
 *
 * - empty (after trim);
 * - exactly `*` or `**` (wildcard, not a domain);
 * - carrying a URI scheme (`://`);
 * - carrying a path or CIDR suffix (`/`);
 * - carrying a port (`:`);
 * - containing no alphanumeric label character at all (e.g. a bare `.`,
 *   `..`, or `-` — added in the 2026-07-18 re-audit's belt-and-suspenders
 *   pass; a destination must carry at least one real domain-label char).
 *
 * This still does not assert a full domain-name grammar — only that an entry
 * is a plausible bare hostname rather than a wildcard, URI, or punctuation.
 */
export function validateNetworkDestination(rawDestination: string): string {
  const trimmed = rawDestination.trim();

  if (trimmed.length === 0) {
    throw new EnvelopeCompilationError(
      `AuthorizationEnvelope.networkDestinations entry is empty after trimming: ${JSON.stringify(rawDestination)}`,
    );
  }
  if (trimmed === "*" || trimmed === "**") {
    throw new EnvelopeCompilationError(
      `AuthorizationEnvelope.networkDestinations entry must be a bare domain name, not a wildcard: ${JSON.stringify(rawDestination)}`,
    );
  }
  if (!/[A-Za-z0-9]/.test(trimmed)) {
    throw new EnvelopeCompilationError(
      `AuthorizationEnvelope.networkDestinations entry must contain at least one alphanumeric label character: ${JSON.stringify(rawDestination)}`,
    );
  }
  if (trimmed.includes("://")) {
    throw new EnvelopeCompilationError(
      `AuthorizationEnvelope.networkDestinations entry must not include a URI scheme: ${JSON.stringify(rawDestination)}`,
    );
  }
  if (trimmed.includes("/")) {
    throw new EnvelopeCompilationError(
      `AuthorizationEnvelope.networkDestinations entry must not include a path or CIDR suffix: ${JSON.stringify(rawDestination)}`,
    );
  }
  if (trimmed.includes(":")) {
    throw new EnvelopeCompilationError(
      `AuthorizationEnvelope.networkDestinations entry must not include a port: ${JSON.stringify(rawDestination)}`,
    );
  }

  return trimmed;
}
