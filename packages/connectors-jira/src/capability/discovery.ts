import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, type CapabilitySnapshot } from "@eo/contracts";
import { z } from "zod";
import { jiraGetJson, type JiraHttpContext } from "../resource-client/http-read-helper.js";
import { RawJiraFieldMetadataListSchema } from "../resource-client/schemas.js";
import type { JiraFieldMetadata } from "../resource-client/types.js";
import { JIRA_ACTIONS } from "../resource-client/actions.js";

/**
 * Capability discovery — roadmap/18 §In scope: "edition/permissions/field
 * metadata → `CapabilitySnapshot` (P02 schema, 16-owned cache/
 * invalidation); unknown editions/versions default read-only." Work item
 * 3. Populates instances of `@eo/gateway`'s `CapabilitySnapshotCache`
 * (16 owns the cache/TTL/invalidation mechanics — this module only
 * supplies the `DiscoverCapabilitySnapshot` function it wraps).
 */
const JIRA_API_FAMILIES = ["rest-v3", "agile-1.0"] as const;

/** The resource kinds this connector's `JiraResourceClient` exposes — used as `CapabilitySnapshot.resources`, independent of any single connection's actual project/board access (that's `ExternalConnection.allowedResources`'s job). */
const JIRA_RESOURCE_KINDS = [
  "project",
  "board",
  "sprint",
  "issue",
  "epic",
  "comment",
  "link",
  "worklog",
  "attachment",
] as const;

const RawJiraServerInfoSchema = z.object({
  version: z.string(),
  deploymentType: z.string().optional(),
});

const RawJiraPermissionsSchema = z.object({
  permissions: z.record(z.string(), z.object({ havePermission: z.boolean() })),
});

function normalizeEdition(deploymentType: string | undefined): "cloud" | "unknown" {
  return deploymentType?.trim().toLowerCase() === "cloud" ? "cloud" : "unknown";
}

/**
 * Discovers one connection's `CapabilitySnapshot`. An unrecognized
 * `deploymentType` (this phase only ever positively confirms `"cloud"`)
 * resolves `edition: "unknown"` and `isReadOnly: true` — roadmap/18 §In
 * scope: "unknown editions/versions default read-only." Return type
 * matches `@eo/gateway`'s `DiscoverCapabilitySnapshot` exactly (omits
 * `discoveredAt`/`expiresAt`, which the cache itself stamps).
 */
export async function discoverJiraCapabilitySnapshot(
  ctx: JiraHttpContext,
): Promise<Omit<CapabilitySnapshot, "discoveredAt" | "expiresAt">> {
  const serverInfo = await jiraGetJson(
    ctx,
    "/rest/api/3/serverInfo",
    RawJiraServerInfoSchema,
    "serverInfo",
  );
  const permissionsResponse = await jiraGetJson(
    ctx,
    "/rest/api/3/mypermissions",
    RawJiraPermissionsSchema,
    "mypermissions",
  );

  const edition = normalizeEdition(serverInfo.deploymentType);
  const grantedPermissions = Object.entries(permissionsResponse.permissions)
    .filter(([, value]) => value.havePermission)
    .map(([key]) => key);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    externalConnectionId: ctx.connection.id,
    product: "jira",
    edition,
    version: serverInfo.version,
    apiFamilies: [...JIRA_API_FAMILIES],
    resources: [...JIRA_RESOURCE_KINDS],
    actions: [...JIRA_ACTIONS],
    permissions: grantedPermissions,
    isReadOnly: edition !== "cloud",
  };
}

const UNRECOGNIZED_FIELD_SCHEMA_TYPE = "__unrecognized__";

/**
 * Discovers this connection's full field-metadata list (`GET /rest/api/3/
 * field`) — `../capability/field-metadata.ts` builds its lookup index
 * from this. A field with no reported `schema.type` (Jira omits this for
 * some system-defined pseudo-fields) is stamped with a sentinel type this
 * connector deliberately never recognizes, so it can never be silently
 * accepted for a custom-field write.
 */
export async function discoverJiraFieldMetadata(
  ctx: JiraHttpContext,
): Promise<readonly JiraFieldMetadata[]> {
  const raw = await jiraGetJson(
    ctx,
    "/rest/api/3/field",
    RawJiraFieldMetadataListSchema,
    "field-metadata",
  );
  return raw.map((entry) => ({
    id: entry.id,
    name: entry.name,
    custom: entry.custom,
    schemaType: entry.schema?.type ?? UNRECOGNIZED_FIELD_SCHEMA_TYPE,
  }));
}
