import {
  GatewayHttpClient,
  createFakeProviderTransport,
  type FakeProviderScriptEntry,
} from "@eo/gateway";
import type { MutationApplyClient } from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import { JiraTokenManager } from "../auth/token-manager.js";
import { AttachmentStagingRegistry } from "../attachments/attachment-staging.js";
import { buildFieldMetadataIndex } from "../capability/field-metadata.js";
import { createJiraMutationApplyClient } from "../resource-client/jira-mutation-apply-client.js";
import { createJiraResourceClient } from "../resource-client/jira-resource-client.js";
import { JiraPlanPayloadRegistry } from "../resource-client/plan-payload-registry.js";
import { createJiraDatacenterMutationApplyClient } from "../resource-client/datacenter/jira-mutation-apply-client-dc.js";
import { createJiraDatacenterResourceClient } from "../resource-client/datacenter/jira-datacenter-resource-client.js";
import type { JiraResourceClient } from "../resource-client/types.js";
import type { JiraDeploymentType } from "../provider/jira-connection-config.js";

/**
 * `ConformanceHarness` — roadmap/19-jira-datacenter-adapter.md work item
 * 5: "Generalize 18's Cloud-only suite into one suite parameterized over
 * `JiraDeploymentType`... Failing test first: invoking the suite with a
 * `datacenter` parameter value fails (unsupported parameterization)
 * before the refactor; after, `cloud` and `datacenter` pass identical
 * assertions." This module IS the "before the refactor, only `cloud`
 * exists" → "after, both deployment types build the SAME harness shape"
 * generalization point: one factory function, parameterized by
 * `JiraDeploymentType`, hiding which concrete resource-client/apply-client
 * pair (Cloud REST v3 vs. this phase's DC REST v2/Agile) backs it —
 * `./parameterized-conformance.integration.test.ts` is the ONE suite that
 * calls this for both values and asserts identically either way.
 *
 * This is deliberately a NEW module, not a rewrite of 18's own
 * `jira-flow.integration.test.ts` (left untouched, unmodified, still
 * green on its own) — see docs/evidence/phase-19/README.md for the
 * documented rationale (avoiding any risk to a phase-18-owned test file).
 */
export interface ConformanceHarness {
  readonly resourceClient: JiraResourceClient;
  readonly applyClient: MutationApplyClient;
  readonly provider: string;
  readonly httpClient: GatewayHttpClient;
  readonly attachmentStaging: AttachmentStagingRegistry;
}

export function buildConformanceHarness(
  deploymentType: JiraDeploymentType,
  responses: readonly FakeProviderScriptEntry[],
  baseUrl: string,
): ConformanceHarness {
  const provider = deploymentType === "cloud" ? "jira-cloud" : "jira-datacenter";
  const connection = buildExternalConnection({ provider, deploymentType, baseUrl });
  const fake = createFakeProviderTransport({ responses });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(baseUrl).origin] },
    resolveHostAddresses: async () => ["203.0.113.150"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  const payloadRegistry = new JiraPlanPayloadRegistry();
  const attachmentStaging = new AttachmentStagingRegistry();

  if (deploymentType === "cloud") {
    const tokenManager = new JiraTokenManager({
      fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
    });
    const ctx = { connection, httpClient, tokenManager };
    const resourceClient = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry,
    });
    const applyClient = createJiraMutationApplyClient({
      ctx,
      payloadRegistry,
      attachmentStaging,
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    return { resourceClient, applyClient, provider, httpClient, attachmentStaging };
  }

  const ctx = {
    connection,
    httpClient,
    authHeaderProvider: async () => ({ authorization: "Bearer dc-pat" }),
  };
  const resourceClient = createJiraDatacenterResourceClient({
    ctx,
    fieldMetadataIndex: buildFieldMetadataIndex([]),
    payloadRegistry,
    dcFeatures: {
      edition: "10.3",
      availableActions: [
        "issue.create",
        "issue.update",
        "issue.transition",
        "issue.link",
        "issue.rank",
        "issue.bulkUpdate",
        "issue.bulkTransition",
        "comment.create",
        "comment.update",
        "worklog.create",
        "attachment.upload",
        "board.create",
        "board.update",
        "sprint.create",
        "sprint.start",
        "sprint.complete",
        "sprint.moveIssues",
      ],
      availableFields: "discovered-only",
    },
  });
  const applyClient = createJiraDatacenterMutationApplyClient({
    ctx,
    payloadRegistry,
    attachmentStaging,
    issueMarkerReconciler: { findByMarker: async () => undefined },
    commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
  });
  return { resourceClient, applyClient, provider, httpClient, attachmentStaging };
}
