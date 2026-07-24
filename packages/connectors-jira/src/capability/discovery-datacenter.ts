import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, type CapabilitySnapshot } from "@eo/contracts";
import { z } from "zod";
import type { JiraDatacenterHttpContext } from "../resource-client/datacenter/jira-datacenter-http-context.js";
import { jiraDatacenterGetJson } from "../resource-client/datacenter/jira-datacenter-http-context.js";
import { resolveDcEditionFeatures, normalizeDcEdition } from "./dc-edition-feature-matrix.js";

/**
 * Data Center capability discovery — roadmap/19-jira-datacenter-
 * adapter.md §In scope: "Field-metadata differences are resolved through
 * a `DcEditionFeatureMatrix` ... feeding capability discovery
 * (`CapabilitySnapshot`, P02). Unrecognized fields or actions return
 * typed `unsupported` — never guessed, never a raw-endpoint fallback."
 * Mirrors `./discovery.ts`'s Cloud shape (same return type, same
 * `serverInfo`/`mypermissions` two-call discovery flow) but resolves
 * `edition`/`isReadOnly`/`actions` from `./dc-edition-feature-matrix.ts`
 * instead of a bare `deploymentType === "cloud"` check.
 */
const JIRA_DATACENTER_API_FAMILIES = ["rest-v2", "agile-1.0"] as const;

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

const RawJiraDatacenterServerInfoSchema = z.object({ version: z.string() });

const RawJiraDatacenterPermissionsSchema = z.object({
  permissions: z.record(z.string(), z.object({ havePermission: z.boolean() })),
});

/**
 * Discovers one Data Center connection's `CapabilitySnapshot`. An
 * unrecognized edition/version — `resolveDcEditionFeatures` returns
 * `undefined` — resolves `edition: "unknown"`, `isReadOnly: true`, and an
 * EMPTY `actions` list (never a guessed subset, never the full
 * `JIRA_ACTIONS` vocabulary assumed by default) — roadmap/19's own
 * "falls back to typed `unsupported` for an unrecognized edition"
 * requirement, expressed at the snapshot level (a caller attempting an
 * action absent from `actions` gets a typed `unsupported` from its own
 * capability-gated call site, never a raw endpoint attempt).
 */
export async function discoverJiraDatacenterCapabilitySnapshot(
  ctx: JiraDatacenterHttpContext,
): Promise<Omit<CapabilitySnapshot, "discoveredAt" | "expiresAt">> {
  const serverInfo = await jiraDatacenterGetJson(
    ctx,
    "/rest/api/2/serverInfo",
    RawJiraDatacenterServerInfoSchema,
    "serverInfo",
  );
  const permissionsResponse = await jiraDatacenterGetJson(
    ctx,
    "/rest/api/2/mypermissions",
    RawJiraDatacenterPermissionsSchema,
    "mypermissions",
  );

  const edition = normalizeDcEdition(serverInfo.version);
  const featureEntry = resolveDcEditionFeatures(edition);
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
    apiFamilies: [...JIRA_DATACENTER_API_FAMILIES],
    resources: [...JIRA_RESOURCE_KINDS],
    actions: featureEntry !== undefined ? [...featureEntry.availableActions] : [],
    permissions: grantedPermissions,
    isReadOnly: featureEntry === undefined,
  };
}
