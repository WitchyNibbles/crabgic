import {
  CURRENT_SCHEMA_VERSION,
  CapabilityManifestSchema,
  type CapabilityManifest,
} from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `CapabilityManifest` fixture builder — roadmap/02 work item 10. */
export function buildCapabilityManifest(
  overrides: Partial<CapabilityManifest> = {},
): CapabilityManifest {
  const ctx = createFixtureContext();
  const defaults: CapabilityManifest = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    changeSetId: ctx.ids.next(),
    createdAt: ctx.clock.next(),
    entries: [],
  };
  return CapabilityManifestSchema.parse({ ...defaults, ...overrides });
}
