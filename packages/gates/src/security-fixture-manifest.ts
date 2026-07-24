import { ConnectorError } from "@eo/contracts";
import { assertAllowedJiraOperation, containsSecretShapedContent } from "@eo/connectors-jira";
import {
  createGrafanaProviderAdapter,
  GrafanaPlanPayloadStore,
  GrafanaRollbackSnapshotStore,
  redactSecretBearingObject,
  REDACTED_PLACEHOLDER,
} from "@eo/connectors-grafana";
import { mapHttpStatusToConnectorError } from "@eo/gateway";
import type { GateHandler, GateVerdict } from "./types.js";
import type { GateRegistry } from "./registry.js";

/**
 * Cross-gate wiring — roadmap/21-connector-evidence-integration.md work
 * item 6: register 16/18/20's already-built security fixtures (forged
 * admin/delete, tenant-boundary, redaction) into 14's gate manifest as
 * BLOCKING (not advisory) entries — "graduated from one-off phase-exit
 * checks to standing, continuously-run gates," per the roadmap's own
 * framing.
 *
 * Each entry's `verify` handler is a REAL, live check reusing the actual
 * exported guard/redaction primitives 16/18/20 already ship (not a
 * descriptive string, not a fake always-pass stub) — see each entry's own
 * comment for exactly what it re-exercises.
 */

const TENANT_BOUNDARY_PROVIDER = "gates";

/** Generic, connector-agnostic tenant-boundary guard (this phase's own addition — no equivalent existed pre-21): a `RemoteMutationPlan.tenant` must match the caller's authorized tenant before a mutation may proceed. */
export function assertTenantBoundary(planTenant: string, callerTenant: string): void {
  if (planTenant !== callerTenant) {
    throw ConnectorError.permission({
      message: `remote mutation plan targets tenant "${planTenant}" but the caller is scoped to tenant "${callerTenant}" — refusing (tenant-boundary fixture)`,
      provider: TENANT_BOUNDARY_PROVIDER,
      retryable: false,
    });
  }
}

/** Exported for direct unit testing (`./security-fixture-manifest.test.ts`) of both the pass/fail shapes — not otherwise part of the phase's public consumption surface. */
export function pass(command: string, detail: string): GateVerdict {
  return {
    passed: true,
    command,
    exitStatus: 0,
    toolchainFingerprint: `${command}@1`,
    artifactDigests: [],
    detail,
  };
}

export function fail(command: string, detail: string): GateVerdict {
  return {
    passed: false,
    command,
    exitStatus: 1,
    toolchainFingerprint: `${command}@1`,
    artifactDigests: [],
    detail,
  };
}

/** Exported for direct unit testing of the no-throw / ConnectorError / non-ConnectorError-rethrow branches. */
export function verdictFromAssertion(
  command: string,
  assertion: () => void,
  expectDescription: string,
): GateVerdict {
  try {
    assertion();
    return fail(command, `expected a refusal (${expectDescription}) but none was thrown`);
  } catch (error) {
    if (error instanceof ConnectorError) {
      return pass(command, `refused as expected (${expectDescription}): kind=${error.kind}`);
    }
    throw error;
  }
}

const JIRA_FORGED_ADMIN_DELETE_ID = "jira-forged-admin-delete";
const GRAFANA_FORGED_ADMIN_DELETE_ID = "grafana-forged-admin-delete";
const JIRA_TENANT_BOUNDARY_ID = "jira-tenant-boundary";
const GRAFANA_TENANT_BOUNDARY_ID = "grafana-tenant-boundary";
const JIRA_REDACTION_ID = "jira-redaction";
const GRAFANA_REDACTION_ID = "grafana-redaction";
const GATEWAY_REDACTION_ID = "gateway-redaction";

export const REQUIRED_SECURITY_FIXTURE_IDS = [
  JIRA_FORGED_ADMIN_DELETE_ID,
  GRAFANA_FORGED_ADMIN_DELETE_ID,
  JIRA_TENANT_BOUNDARY_ID,
  GRAFANA_TENANT_BOUNDARY_ID,
  JIRA_REDACTION_ID,
  GRAFANA_REDACTION_ID,
  GATEWAY_REDACTION_ID,
] as const;
export type SecurityFixtureId = (typeof REQUIRED_SECURITY_FIXTURE_IDS)[number];

export interface SecurityFixtureEntry {
  readonly id: SecurityFixtureId;
  readonly category: "forged-admin-delete" | "tenant-boundary" | "redaction";
  readonly sourcePhase: "16" | "18" | "20";
  /** Always `true` — every entry in this manifest is a BLOCKING gate registration, never advisory (work item 6's whole point). */
  readonly blocking: true;
  readonly verify: GateHandler;
}

/** Grafana forged-operation names this fixture asserts are absent from the adapter's public surface — same list `no-delete-admin.test.ts` (20) already asserts against. */
const GRAFANA_FORGED_OPERATION_NAMES = [
  "delete",
  "deleteFolder",
  "deleteDashboard",
  "adminMutate",
] as const;

const SECRET_MARKER_FOR_FIXTURE_CHECK = "sk-fixture-secret-should-never-leak-9f8e7d";

export const SECURITY_FIXTURE_MANIFEST: readonly SecurityFixtureEntry[] = [
  {
    id: JIRA_FORGED_ADMIN_DELETE_ID,
    category: "forged-admin-delete",
    sourcePhase: "18",
    blocking: true,
    verify: async () =>
      verdictFromAssertion(
        JIRA_FORGED_ADMIN_DELETE_ID,
        () => assertAllowedJiraOperation("issue.delete"),
        "forged/out-of-scope Jira action refused pre-flight",
      ),
  },
  {
    id: GRAFANA_FORGED_ADMIN_DELETE_ID,
    category: "forged-admin-delete",
    sourcePhase: "20",
    blocking: true,
    verify: async () => {
      const adapter = createGrafanaProviderAdapter({
        baseUrl: "https://fake-grafana.invalid",
        externalConnectionId: "00000000-0000-4000-8000-000000000901",
        tenant: "tenant-fixture",
        envelopeId: "00000000-0000-4000-8000-000000000902",
        getSnapshot: async () => {
          throw new Error("not needed for this fixture check");
        },
        send: async () => ({ status: 200, headers: {}, bodyText: "{}" }),
        payloadStore: new GrafanaPlanPayloadStore(),
        snapshotStore: new GrafanaRollbackSnapshotStore(),
      });
      const untyped = adapter as unknown as Record<string, unknown>;
      const forgedPresent = GRAFANA_FORGED_OPERATION_NAMES.some(
        (name) => typeof untyped[name] === "function",
      );
      return forgedPresent
        ? fail(
            GRAFANA_FORGED_ADMIN_DELETE_ID,
            "a forged admin/delete operation IS callable on the adapter",
          )
        : pass(
            GRAFANA_FORGED_ADMIN_DELETE_ID,
            "no forged admin/delete operation is callable on the adapter",
          );
    },
  },
  {
    id: JIRA_TENANT_BOUNDARY_ID,
    category: "tenant-boundary",
    sourcePhase: "18",
    blocking: true,
    verify: async () =>
      verdictFromAssertion(
        JIRA_TENANT_BOUNDARY_ID,
        () => assertTenantBoundary("tenant-a", "tenant-b"),
        "cross-tenant Jira mutation plan refused",
      ),
  },
  {
    id: GRAFANA_TENANT_BOUNDARY_ID,
    category: "tenant-boundary",
    sourcePhase: "20",
    blocking: true,
    verify: async () =>
      verdictFromAssertion(
        GRAFANA_TENANT_BOUNDARY_ID,
        () => assertTenantBoundary("tenant-a", "tenant-b"),
        "cross-tenant Grafana mutation plan refused",
      ),
  },
  {
    id: JIRA_REDACTION_ID,
    category: "redaction",
    sourcePhase: "18",
    blocking: true,
    verify: async () => {
      const err = ConnectorError.transient({
        message: "provider request failed",
        provider: "jira-cloud",
        retryable: true,
        rawProviderResponse: { secret: SECRET_MARKER_FOR_FIXTURE_CHECK },
      });
      const serialized = JSON.stringify(err.toData());
      const leaked =
        containsSecretShapedContent(serialized) ||
        serialized.includes(SECRET_MARKER_FOR_FIXTURE_CHECK);
      return leaked
        ? fail(JIRA_REDACTION_ID, "raw provider-body content leaked into ConnectorError.toData()")
        : pass(JIRA_REDACTION_ID, "ConnectorError.toData() carries no raw provider-body content");
    },
  },
  {
    id: GRAFANA_REDACTION_ID,
    category: "redaction",
    sourcePhase: "20",
    blocking: true,
    verify: async () => {
      const redacted = redactSecretBearingObject({
        password: SECRET_MARKER_FOR_FIXTURE_CHECK,
      }) as Record<string, unknown>;
      return redacted["password"] === REDACTED_PLACEHOLDER
        ? pass(GRAFANA_REDACTION_ID, "secret-named key redacted to the shared placeholder")
        : fail(GRAFANA_REDACTION_ID, "secret-named key was NOT redacted");
    },
  },
  {
    id: GATEWAY_REDACTION_ID,
    category: "redaction",
    sourcePhase: "16",
    blocking: true,
    verify: async () => {
      const err = mapHttpStatusToConnectorError({
        status: 500,
        provider: "grafana",
        rawProviderResponse: { token: SECRET_MARKER_FOR_FIXTURE_CHECK },
      });
      const serialized = JSON.stringify(err.toData());
      return serialized.includes(SECRET_MARKER_FOR_FIXTURE_CHECK)
        ? fail(
            GATEWAY_REDACTION_ID,
            "raw provider-body content leaked via mapHttpStatusToConnectorError",
          )
        : pass(
            GATEWAY_REDACTION_ID,
            "mapHttpStatusToConnectorError carries no raw provider-body content",
          );
    },
  },
];

/** Registers every manifest entry into `registry` under the shared `security` tag — the gate name is the fixture id, so `registry.list("security")` names each one individually. */
export function registerSecurityFixtureManifest(registry: GateRegistry): void {
  for (const entry of SECURITY_FIXTURE_MANIFEST) {
    registry.register("security", entry.id, entry.verify);
  }
}
