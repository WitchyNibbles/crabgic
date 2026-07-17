import {
  CURRENT_SCHEMA_VERSION,
  RenderedArtifactSchema,
  type RenderedArtifact,
} from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `RenderedArtifact` fixture builder — roadmap/02 work item 10. */
export function buildRenderedArtifact(overrides: Partial<RenderedArtifact> = {}): RenderedArtifact {
  const ctx = createFixtureContext();
  const defaults: RenderedArtifact = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    kind: "commit_subject",
    content: "fix(fixtures): deterministic testkit rendered-artifact content",
    renderedAt: ctx.clock.next(),
  };
  return RenderedArtifactSchema.parse({ ...defaults, ...overrides });
}
