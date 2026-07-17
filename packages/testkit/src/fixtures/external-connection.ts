import {
  CURRENT_SCHEMA_VERSION,
  ExternalConnectionSchema,
  type ExternalConnection,
} from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `ExternalConnection` fixture builder — roadmap/02 work item 10. */
export function buildExternalConnection(
  overrides: Partial<ExternalConnection> = {},
): ExternalConnection {
  const ctx = createFixtureContext();
  const defaults: ExternalConnection = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    provider: "jira",
    baseUrl: "https://example.atlassian.net",
    allowedRedirectOrigins: [],
    allowedResources: ["issue"],
    allowedActions: ["read"],
    discoveryTtlSeconds: 900,
    secretRef: { backend: "env", variable: "EXAMPLE_PROVIDER_TOKEN" },
  };
  return ExternalConnectionSchema.parse({ ...defaults, ...overrides });
}
