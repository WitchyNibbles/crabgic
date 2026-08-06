import { ConnectorError } from "@crabgic/contracts";
import {
  assertAllowedJiraOperation,
  containsSecretShapedContent,
  JIRA_SECURITY_FIXTURE_MATRIX,
  JIRA_TENANT_BOUNDARY_IN_ALLOWLIST_TENANT,
  makeJiraTenantBoundaryBreachScenario,
} from "@crabgic/connectors-jira";
import type { JiraSecurityScenario } from "@crabgic/connectors-jira";
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
 *
 * ── CORRECTION 2026-08-06 (Batch H). The paragraph above is left verbatim
 * and corrected here, not rewritten. There are now **SEVEN** entries, and the
 * tenant-boundary category is borne by **TWO**: phase 20's Grafana one and
 * phase 18's new Jira one (`jiraTenantBoundaryVerify`). The condition the
 * ruling below set for a Jira twin — that one "returns only together with
 * real Jira-side enforcement", i.e. a real Jira FIXTURE — is now met by
 * `packages/connectors-jira/src/fixtures/tenant-boundary-scenario.ts`. The
 * dated addendum on that ruling states exactly what did and did not change.
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
const JIRA_TENANT_BOUNDARY_ID = "jira-tenant-boundary";
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
 *
 * ── CORRECTION 2026-08-05 (defect 21). The paragraph above is annotated,
 * not rewritten, because the ruling it reaches is still correct and the
 * measurement it rested on is now partly stale.
 *
 * NOW FALSE: "`ExternalConnection.tenantAllowlist` ... is declared but
 * enforced by zero production code." It IS enforced, by
 * `refuseOutOfAllowlistTenant` in
 * `packages/gateway/src/mutation-pipeline/mutation-pipeline.ts` — a
 * provider-agnostic admission check in `executeMutationPlan` comparing
 * `RemoteMutationPlan.tenant` against the connection's `tenantAllowlist`
 * and refusing a non-member with the canonical `policy_blocked` kind
 * before any network I/O or journal write. The Jira Cloud and Data Center
 * resource clients now derive `plan.tenant` from `tenantAllowlist` first.
 *
 * STILL TRUE, and why the RULING itself does not change:
 *  - The enforcement is GATEWAY-owned and provider-agnostic. It is not
 *    "Jira-side enforcement", so this manifest's condition for re-adding a
 *    Jira tenant-boundary entry ("returns only together with real
 *    Jira-side enforcement" — i.e. Jira FIXTURES) is unmet. No entry is
 *    added here, and test T2 keeps pinning that.
 *  - `plan.tenant` is still ALSO the per-tenant+resource write-mutex key.
 *    Gaining an authorization role did not remove the concurrency role.
 *  - The new check binds DECLARED plan attribution on the MUTATION path.
 *    Reads are not tenant-checked and the remote's actual tenant identity
 *    is still not verified — both are named residuals, so "a real tenant
 *    boundary" in the full sense remains unbuilt.
 *
 * LINE NUMBERS in the paragraph above have shifted and are left as written
 * (annotate, never rewrite). Current locations of the same three things:
 * the Jira Cloud tenant derivation is `jira-resource-client.ts:87` (the
 * Data Center twin is `datacenter/jira-datacenter-resource-client.ts:108`);
 * the write-mutex key is still `gateway/src/transport/http-client.ts:139`,
 * unmoved; and the contract field is now
 * `packages/contracts/src/contracts/external-connection.ts:117`.
 *
 * ── ADDENDUM 2026-08-06 (Batch H). THE RULING IS DISCHARGED, on its own
 * terms, and a Jira tenant-boundary entry is added. Everything above stays
 * as written.
 *
 * The 2026-08-05 correction left exactly one thing outstanding: it read the
 * ruling's condition as "Jira FIXTURES" and recorded that none existed. One
 * does now — `packages/connectors-jira/src/fixtures/tenant-boundary-scenario.ts`,
 * shipped from `@crabgic/connectors-jira`'s barrel. It is a Jira fixture in
 * the sense the ruling meant: it builds a `RemoteMutationPlan` with the REAL
 * Jira plan builders (`createJiraResourceClient`), assembles handlers from
 * the REAL Jira `MutationApplyClient`, and applies it through the REAL
 * `executeMutationPlan` — so the entry is not a gates-owned guard with no
 * production call path, which is the specific vacuity the ruling forbade.
 *
 * STILL TRUE, so nobody over-reads the addition:
 *  - The ENFORCEMENT remains gateway-owned and provider-agnostic. Phase 18
 *    owns the fixture, not the check. Adding this entry does not make the
 *    tenant boundary "Jira-side"; it makes the Jira side EXERCISED.
 *  - `plan.tenant` is still also the per-tenant+resource write-mutex key.
 *  - The check still binds DECLARED plan attribution on the MUTATION path.
 *    Reads are not tenant-checked and the remote's actual tenant identity is
 *    still unverified. No detail string in this file may say that
 *    cross-tenant access is refused — the contract's own wording
 *    (`packages/contracts/src/contracts/external-connection.ts:122`) says it
 *    is not a guarantee of that, and the fixture's own tests assert the
 *    absence of that phrase in both the pass and the fail worlds.
 *  - The Grafana entry is untouched: same id, same `sourcePhase: "20"`, same
 *    handler, same `blocking: true`.
 *
 * Test T2 (which pinned the ABSENCE of a Jira entry) is superseded by T2' in
 * `./security-fixture-manifest.test.ts`. Stated precisely, because
 * "annotate, never rewrite" is a claim about PROSE and conflating it with
 * code would be an overclaim: T2's original comment AND its original title
 * are quoted verbatim in that file, and the ruling above is annotated rather
 * than edited — but T2's ASSERTIONS and its TITLE necessarily changed, since
 * the old ones assert the negation of the current invariant and cannot be
 * kept green. (The title was replaced for a second reason: a ✓ printed beside
 * "exactly ONE tenant-boundary entry exists" in every CI job log is a
 * citation hazard in a repository that proves claims by quoting job-log
 * lines.) The pin still did its job — re-adding a Jira entry was impossible
 * without a deliberate edit here and there.
 */
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

/**
 * The Jira half of the tenant-boundary category (phase 18's fixture, added
 * 2026-08-06 — see the ADDENDUM above `REQUIRED_SECURITY_FIXTURE_IDS`).
 *
 * Structurally the twin of `grafanaTenantBoundaryVerify`, and deliberately so:
 * select the tenant-boundary scenarios out of the connector's own exported
 * matrix, refuse an EMPTY selection rather than passing vacuously over zero
 * scenarios, run each, and then run a POSITIVE CONTROL that the refusals
 * cannot be explained by a refuse-everything implementation.
 *
 * The control differs in shape from Grafana's, because the thing being
 * controlled differs. Grafana's control calls the real doctor directly with an
 * in-allowlist identity. Jira's tenant check lives one layer up (in
 * `executeMutationPlan`), so the control is built from the SAME real factory
 * with the breach arm's declared tenant swapped to an IN-allowlist one: that
 * scenario must then report `passed: false`. In other words the gate passes
 * only if the same machinery yields DIFFERENT verdicts for an out-of-allowlist
 * and an in-allowlist declared tenant — which is exactly what a constant
 * verdict (the original defect) cannot do.
 *
 * Both parameters default to the real matrix and the real factory; they are
 * injectable for the direct unit tests, same convention as
 * `grafanaTenantBoundaryVerify`.
 * ⚠️ Injected-path tests cannot prove the DEFAULT path stays coupled to
 * `packages/connectors-jira` or, through it, to the gateway's real
 * `refuseOutOfAllowlistTenant` — the deletion probe
 * `docs/evidence/phase-21/fix-21c5-jira-tenant-boundary-probe-batchH.txt`
 * is that proof.
 */
export async function jiraTenantBoundaryVerify(
  scenarios: readonly JiraSecurityScenario[] = JIRA_SECURITY_FIXTURE_MATRIX,
  makeScenario: typeof makeJiraTenantBoundaryBreachScenario = makeJiraTenantBoundaryBreachScenario,
): Promise<GateVerdict> {
  const selected = scenarios.filter((scenario) => scenario.category === "tenant-boundary");
  if (selected.length === 0) {
    return fail(
      JIRA_TENANT_BOUNDARY_ID,
      "no tenant-boundary scenario was selected from the Jira security-fixture matrix — an empty selection would pass vacuously, so this gate refuses instead",
    );
  }

  for (const scenario of selected) {
    const result = await scenario.run();
    if (!result.passed) {
      return fail(
        JIRA_TENANT_BOUNDARY_ID,
        `tenant-boundary scenario "${scenario.name}" FAILED: ${result.detail}`,
      );
    }
  }

  const control = await makeScenario({
    declaredTenant: JIRA_TENANT_BOUNDARY_IN_ALLOWLIST_TENANT,
  }).run();
  if (control.passed) {
    return fail(
      JIRA_TENANT_BOUNDARY_ID,
      `positive control broken — the same machinery still reports a refusal when the plan declares an IN-allowlist tenant, so the refusals above prove nothing: ${control.detail}`,
    );
  }

  // SECOND control, and it exists because a measurement said it had to. Probe
  // B2 in `docs/evidence/phase-21/fix-21c5-jira-tenant-boundary-probe-batchH.txt`
  // disabled the scenario's OWN positive-control conjunct: the connector's unit
  // suite reddened (3 tests) and this gate stayed green, because the control
  // above only exercises the scenario's BREACH conjunct. An empty
  // `tenantAllowlist` refuses every mutation (fail-closed), so the scenario's
  // in-allowlist arm cannot be admitted and it MUST report `passed: false` —
  // a scenario that still reports success under `[]` is not reading its own
  // control at all. With this here, B2 reddens the gate too.
  const failClosedControl = await makeScenario({ tenantAllowlist: [] }).run();
  if (failClosedControl.passed) {
    return fail(
      JIRA_TENANT_BOUNDARY_ID,
      `positive control broken — the scenario still reports success against an EMPTY tenantAllowlist, under which its own in-allowlist arm cannot have been admitted: ${failClosedControl.detail}`,
    );
  }

  return pass(
    JIRA_TENANT_BOUNDARY_ID,
    `refused as expected: ${selected.map((scenario) => scenario.name).join("; ")}; positive control discriminates — the same scenario with an in-allowlist declared tenant reports no refusal`,
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
    // Drives 18's `JIRA_SECURITY_FIXTURE_MATRIX` breach scenario: a real
    // Jira-built `RemoteMutationPlan` declaring an out-of-allowlist tenant,
    // refused by the real `executeMutationPlan` before any network I/O or
    // journal write, plus a positive control that an in-allowlist declared
    // tenant is NOT refused. See `jiraTenantBoundaryVerify` above and the
    // 2026-08-06 ADDENDUM on the ruling for why this entry exists now and
    // what it does not claim.
    id: JIRA_TENANT_BOUNDARY_ID,
    category: "tenant-boundary",
    sourcePhase: "18",
    blocking: true,
    verify: async () => jiraTenantBoundaryVerify(),
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
