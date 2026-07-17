import {
  AuthorizationEnvelopeSchema,
  CURRENT_SCHEMA_VERSION,
  type AuthorizationEnvelope,
} from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `AuthorizationEnvelope` fixture builder — roadmap/02 work item 10. */
export function buildAuthorizationEnvelope(
  overrides: Partial<AuthorizationEnvelope> = {},
): AuthorizationEnvelope {
  const ctx = createFixtureContext();
  const defaults: AuthorizationEnvelope = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    changeSetId: ctx.ids.next(),
    createdAt: ctx.clock.next(),
    canonicalHash: "sha256:deterministic-fixture-envelope-hash",
    ownedPaths: ["packages/example/src/"],
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
