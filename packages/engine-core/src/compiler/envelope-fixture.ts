import {
  AuthorizationEnvelopeSchema,
  CURRENT_SCHEMA_VERSION,
  type AuthorizationEnvelope,
} from "@eo/contracts";

/**
 * Test-support fixture builder, scoped to this package only — mirrors
 * `packages/testkit/src/fixtures/authorization-envelope.ts`'s shape by
 * hand rather than importing `@eo/testkit`: this package (`@eo/engine-core`)
 * must not depend on `@eo/testkit`, since `@eo/testkit`'s own fake engine
 * (roadmap/03 work item 5, a different worker's deliverable) implements
 * `EngineAdapter` FROM this package — a `@eo/testkit -> @eo/engine-core`
 * edge already exists in that direction, so the reverse would be
 * circular.
 *
 * Every field defaults to an empty/neutral value; callers override only
 * the fields relevant to the behavior under test.
 */
export function buildEnvelopeFixture(
  overrides: Partial<AuthorizationEnvelope> = {},
): AuthorizationEnvelope {
  const defaults: AuthorizationEnvelope = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
    changeSetId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
    createdAt: "2026-07-15T12:00:00.000Z",
    canonicalHash: "sha256:deterministic-fixture-envelope-hash",
    ownedPaths: [],
    commands: [],
    networkDestinations: [],
    credentialReferences: [],
    dependencies: [],
    remoteResourceAuthorizations: [],
    temporaryServices: [],
    prohibitedActions: [],
  };
  return AuthorizationEnvelopeSchema.parse({ ...defaults, ...overrides });
}
