import { ConnectorError } from "@crabgic/contracts";
import { assertAllowedJiraOperation, containsSecretShapedContent } from "@crabgic/connectors-jira";
import {
  checkGrafanaConnectionDoctor,
  createGrafanaProviderAdapter,
  FAULT_INJECTION_MATRIX,
  GrafanaPlanPayloadStore,
  GrafanaRollbackSnapshotStore,
  redactSecretBearingObject,
  REDACTED_PLACEHOLDER,
} from "@crabgic/connectors-grafana";
import type { FaultInjectionScenario } from "@crabgic/connectors-grafana";
import { mapHttpStatusToConnectorError } from "@crabgic/gateway";
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
 *
 * Six entries. The tenant-boundary category is borne by ONE entry, phase
 * 20's — see `grafanaTenantBoundaryVerify` and the ruling comment above the
 * `grafana-tenant-boundary` entry for why there is no Jira twin.
 */

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
const GRAFANA_TENANT_BOUNDARY_ID = "grafana-tenant-boundary";
const JIRA_REDACTION_ID = "jira-redaction";
const GRAFANA_REDACTION_ID = "grafana-redaction";
const GATEWAY_REDACTION_ID = "gateway-redaction";

/**
 * RULING (tenant-boundary is Grafana-only, and that is a decision, not an
 * oversight). There is exactly ONE tenant-boundary entry, phase 20's. The
 * criterion's "16/18/20's security fixtures (… tenant boundary …)" reads as
 * the fixtures those phases actually built, and only 20 built a
 * tenant-boundary one (`roadmap/20-grafana-adapters.md` §Interfaces produced).
 *
 * The opposite case, named so the distinction is legible: a Jira entry would
 * NOT be "one more gate" — it would be a gates-owned guard with no production
 * call path, i.e. dead code cited as a bearer, which is the same vacuity this
 * file is being repaired for. Nothing in `packages/connectors-jira` or
 * `@crabgic/gateway` enforces a tenant boundary today: `plan.tenant` is
 * derived (`jira-resource-client.ts:68`) and consumed only as a
 * per-tenant+resource write-mutex key (`gateway/src/transport/http-client.ts:139`),
 * and `ExternalConnection.tenantAllowlist`
 * (`packages/contracts/src/contracts/external-connection.ts:85`) is declared
 * but enforced by zero production code.
 *
 * The spec was silent on what to do when a named phase never shipped the
 * fixture; the silence is filled by this ruling. A Jira entry returns only
 * together with real Jira-side enforcement — and the residual is pinned by
 * test T2 in `./security-fixture-manifest.test.ts`, so re-adding one is a
 * deliberate edit rather than a drift.
 */
export const REQUIRED_SECURITY_FIXTURE_IDS = [
  JIRA_FORGED_ADMIN_DELETE_ID,
  GRAFANA_FORGED_ADMIN_DELETE_ID,
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

/** Identity used by the positive control below: in-allowlist org, sufficient role — enforcement MUST accept it. */
const CONTROL_ORG_ID = 7;

/**
 * The tenant-boundary gate. Drives phase 20's own `tenantBoundaryBreachScenario`
 * out of `FAULT_INJECTION_MATRIX` — the scenario calls the real
 * `checkGrafanaConnectionDoctor` with an out-of-allowlist org and self-verifies
 * — and then runs a positive control through the doctor directly.
 *
 * Why the control exists: the scenario alone passes on ANY refusal, so an
 * enforcement that refused everything would keep this gate green while being
 * just as broken. The control asserts the opposite case — an in-allowlist
 * identity IS accepted — so the gate can only pass when enforcement
 * discriminates. (Brief: pin a "fails" ruling with a "does not fail" control;
 * it lives inside the gate rather than only in a test, because the gate is the
 * standing artifact.)
 *
 * Why an empty selection FAILS: a `for` loop over zero scenarios would pass
 * vacuously, which is the exact class of defect this function replaces.
 *
 * Both parameters default to the real matrix and the real doctor; they are
 * injectable for the direct unit tests (same convention as `verdictFromAssertion`).
 * ⚠️ Injected-path tests cannot prove the DEFAULT path stays coupled to
 * `packages/connectors-grafana` — the deletion probe
 * `docs/evidence/phase-21/fix-c5-tenant-boundary-probe.txt` is that proof.
 */
export async function grafanaTenantBoundaryVerify(
  scenarios: readonly FaultInjectionScenario[] = FAULT_INJECTION_MATRIX,
  doctor: typeof checkGrafanaConnectionDoctor = checkGrafanaConnectionDoctor,
): Promise<GateVerdict> {
  const selected = scenarios.filter((scenario) => scenario.category === "tenant-boundary");
  if (selected.length === 0) {
    return fail(
      GRAFANA_TENANT_BOUNDARY_ID,
      "no tenant-boundary scenario was selected from the fault-injection matrix — an empty selection would pass vacuously, so this gate refuses instead",
    );
  }

  for (const scenario of selected) {
    const result = await scenario.run();
    if (!result.passed) {
      return fail(
        GRAFANA_TENANT_BOUNDARY_ID,
        `tenant-boundary scenario "${scenario.name}" FAILED: ${result.detail}`,
      );
    }
  }

  const control = await doctor({
    fetchTokenInfo: async () => ({ orgId: CONTROL_ORG_ID, role: "Editor" }),
    orgAllowlist: [String(CONTROL_ORG_ID)],
  });
  if (!control.ok) {
    return fail(
      GRAFANA_TENANT_BOUNDARY_ID,
      `positive control broken — enforcement refused an in-allowlist identity (org ${CONTROL_ORG_ID}, role Editor), so the refusals above prove nothing: ${control.reason}`,
    );
  }

  return pass(
    GRAFANA_TENANT_BOUNDARY_ID,
    `refused as expected: ${selected.map((scenario) => scenario.name).join("; ")}; positive control accepted an in-allowlist identity (org ${control.orgId}, role ${control.role})`,
  );
}

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
    // Re-exercises 20's `tenantBoundaryBreachScenario` (out-of-allowlist org
    // refused by the real `checkGrafanaConnectionDoctor`) plus a positive
    // control that an in-allowlist identity is accepted. See the RULING above
    // `REQUIRED_SECURITY_FIXTURE_IDS` for why there is no Jira twin.
    id: GRAFANA_TENANT_BOUNDARY_ID,
    category: "tenant-boundary",
    sourcePhase: "20",
    blocking: true,
    verify: async () => grafanaTenantBoundaryVerify(),
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
