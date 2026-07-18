import {
  AuthorizationEnvelopeSchema,
  CURRENT_SCHEMA_VERSION,
  type AuthorizationEnvelope,
} from "@eo/contracts";

/**
 * The three canonical `AuthorizationEnvelope`s (roadmap/03-envelope-
 * compiler-engine-adapter.md §In scope: "Golden settings artifacts for
 * three canonical envelopes (read-only, standard implementation,
 * network-granted)"). Fixed literal ids/timestamps/hashes (never
 * `Date.now()`/`crypto.randomUUID()`) so `compileEnvelope`'s output is
 * byte-stable across every run, on every machine — the golden-artifact
 * byte-stability exit criterion depends on it (`../../goldens/
 * generate-golden-artifacts.test.ts` and the committed
 * `../../goldens/*.json` files this module ultimately produces).
 */
function baseEnvelope(
  overrides: Partial<AuthorizationEnvelope> & Pick<AuthorizationEnvelope, "id" | "changeSetId">,
): AuthorizationEnvelope {
  return AuthorizationEnvelopeSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: "2026-07-15T12:00:00.000Z",
    canonicalHash: "sha256:canonical-envelope-fixture-hash",
    ownedPaths: [],
    commands: [],
    networkDestinations: [],
    credentialReferences: [],
    dependencies: [],
    remoteResourceAuthorizations: [],
    temporaryServices: [],
    prohibitedActions: [],
    ...overrides,
  });
}

/**
 * Read-only: no owned paths (no `Edit`/`Write` allow), no authorized
 * commands (no `Bash(...)` allow), no network, no credentials — exercises
 * the compiler's floor: only the mandatory gateway allow + mandatory
 * denies.
 */
export const READ_ONLY_ENVELOPE: AuthorizationEnvelope = baseEnvelope({
  id: "11111111-1111-4111-8111-111111111111",
  changeSetId: "11111111-1111-4111-8111-111111111112",
  canonicalHash: "sha256:read-only-canonical-envelope",
});

/**
 * Standard implementation: one owned path, all four doc-confirmed Bash
 * command prefixes authorized, no network/credentials — exercises the
 * full `Edit`/`Write`/`Bash(...)` allow emission with zero network grant.
 */
export const STANDARD_IMPLEMENTATION_ENVELOPE: AuthorizationEnvelope = baseEnvelope({
  id: "22222222-2222-4222-8222-222222222221",
  changeSetId: "22222222-2222-4222-8222-222222222222",
  canonicalHash: "sha256:standard-implementation-canonical-envelope",
  ownedPaths: ["packages/example/src"],
  commands: ["npm run test", "npm run build", "git status", "git diff"],
});

/**
 * Network-granted: one owned path, two of the four Bash prefixes
 * authorized, one network destination, one credential reference —
 * exercises `sandbox.network.allowedDomains` and
 * `sandbox.credentials.envVars` emission together.
 */
export const NETWORK_GRANTED_ENVELOPE: AuthorizationEnvelope = baseEnvelope({
  id: "33333333-3333-4333-8333-333333333331",
  changeSetId: "33333333-3333-4333-8333-333333333332",
  canonicalHash: "sha256:network-granted-canonical-envelope",
  ownedPaths: ["packages/example/src"],
  commands: ["npm run test", "git status"],
  networkDestinations: ["api.example.com"],
  credentialReferences: ["EO_EXAMPLE_API_TOKEN"],
});

export interface CanonicalEnvelopeCase {
  readonly name: "read-only" | "standard-implementation" | "network-granted";
  readonly envelope: AuthorizationEnvelope;
}

/** Fixed, ordered list — the single source of truth for "all three canonical envelopes." */
export const CANONICAL_ENVELOPE_CASES: readonly CanonicalEnvelopeCase[] = [
  { name: "read-only", envelope: READ_ONLY_ENVELOPE },
  { name: "standard-implementation", envelope: STANDARD_IMPLEMENTATION_ENVELOPE },
  { name: "network-granted", envelope: NETWORK_GRANTED_ENVELOPE },
];
