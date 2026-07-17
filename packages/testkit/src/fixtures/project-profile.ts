import { CURRENT_SCHEMA_VERSION, ProjectProfileSchema, type ProjectProfile } from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `ProjectProfile` fixture builder — roadmap/02 work item 10. */
export function buildProjectProfile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  const ctx = createFixtureContext();
  const defaults: ProjectProfile = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    createdAt: ctx.clock.next(),
    ecosystems: [
      {
        ecosystem: "node",
        packagePath: ".",
        testCommands: { unit: "npm test" },
      },
    ],
  };
  return ProjectProfileSchema.parse({ ...defaults, ...overrides });
}
