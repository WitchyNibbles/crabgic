import { CURRENT_SCHEMA_VERSION, RemoteResourceSchema, type RemoteResource } from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `RemoteResource` fixture builder — roadmap/02 work item 10. */
export function buildRemoteResource(overrides: Partial<RemoteResource> = {}): RemoteResource {
  const ctx = createFixtureContext();
  const defaults: RemoteResource = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    externalConnectionId: ctx.ids.next(),
    resourceKind: "issue",
    externalId: "EXAMPLE-1",
    revision: "1",
    observedAt: ctx.clock.next(),
  };
  return RemoteResourceSchema.parse({ ...defaults, ...overrides });
}
