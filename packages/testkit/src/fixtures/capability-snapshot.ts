import {
  CURRENT_SCHEMA_VERSION,
  CapabilitySnapshotSchema,
  type CapabilitySnapshot,
} from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `CapabilitySnapshot` fixture builder — roadmap/02 work item 10. */
export function buildCapabilitySnapshot(
  overrides: Partial<CapabilitySnapshot> = {},
): CapabilitySnapshot {
  const ctx = createFixtureContext();
  const discoveredAt = ctx.clock.next();
  const expiresAt = ctx.clock.next();
  const defaults: CapabilitySnapshot = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    externalConnectionId: ctx.ids.next(),
    product: "jira",
    edition: "cloud",
    version: "unknown",
    apiFamilies: ["rest-v3"],
    resources: ["issue"],
    actions: ["read"],
    permissions: ["BROWSE_PROJECTS"],
    isReadOnly: true,
    discoveredAt,
    expiresAt,
  };
  return CapabilitySnapshotSchema.parse({ ...defaults, ...overrides });
}
