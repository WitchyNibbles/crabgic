import { CapabilitySnapshotSchema, CURRENT_SCHEMA_VERSION } from "@crabgic/contracts";
import type { CapabilitySnapshot } from "@crabgic/contracts";
import { createGrafanaProviderAdapter } from "../adapter.js";
import type { GrafanaProviderAdapter, GrafanaProviderAdapterDeps } from "../adapter.js";
import { checkGrafanaConnectionDoctor } from "../auth/connection-doctor.js";
import { GrafanaPlanPayloadStore } from "../mutation/plan-payload-store.js";
import { GrafanaRollbackSnapshotStore } from "../mutation/snapshot-store.js";
import { assertWritableCapability } from "../mutation/write-eligibility-guard.js";
import { GRAFANA_RESOURCE_KINDS } from "../resource-kinds.js";
import type { GrafanaRawHttpResponse } from "../mutation/mutation-apply-client.js";

/**
 * Fault-injection matrix — roadmap/20-grafana-adapters.md §Interfaces
 * produced: "Fault-injection fixtures (forged delete/admin, tenant-boundary
 * breach, redaction-check) — consumed by 21 work item 6 ('connector
 * security fixtures... run inside 14's framework') and by 23's
 * Connector-security E2E bullet." Each scenario is self-contained and
 * self-verifying (`run()` returns its own pass/fail), so 21/23 can drive
 * this matrix directly without re-deriving each scenario's assertion.
 */
export interface FaultInjectionScenario {
  readonly name: string;
  readonly category: "forged-delete-admin" | "tenant-boundary" | "redaction";
  readonly run: () => Promise<{ readonly passed: boolean; readonly detail: string }>;
}

/** Exported for `fault-injection.test.ts`'s own direct unit coverage of this helper's body — the scenario itself asserts `calls.length === 0`, so the `send` function's own implementation is otherwise only ever reachable from a REGRESSION (a forged call that unexpectedly succeeded in reaching the network). */
export function neverCalledSend() {
  const calls: unknown[] = [];
  const send = async (spec: unknown): Promise<GrafanaRawHttpResponse> => {
    calls.push(spec);
    return { status: 200, headers: {}, bodyText: "{}" };
  };
  return { send, calls };
}

/**
 * ── Injectable-dependency seams (defect `20-fault-injection-scenarios-have-unpinned-oracles`).
 *
 * Each scenario below is built by a factory whose every override DEFAULTS TO THE
 * REAL PRODUCTION DEPENDENCY, and the module-level scenario constants — the exact
 * objects `FAULT_INJECTION_MATRIX` holds and `@crabgic/gates`'
 * `grafanaTenantBoundaryVerify` executes — are those factories' zero-argument
 * products. There is no test-only copy: the default-argument closure IS the object
 * production runs. The seam exists because the scenarios previously hardcoded their
 * whole world (org 999 vs allowlist `["7"]`, the real adapter, the real guard), so
 * no test could construct a world in which a scenario OUGHT to fail — and attack G
 * measured the consequence: mutating `passed: result.ok === false` to `passed: true`
 * left 83 files / 660 tests green across gates + connectors-grafana.
 *
 * `FaultInjectionScenario` and `run`'s zero-argument signature are deliberately
 * left byte-identical, so gates' `scenario.run()` call sites and its `run: async
 * () => …` stubs are untouched by this change.
 *
 * ⚠️ RESIDUAL, stated where the reader lands rather than only in a report.
 * Injected-path tests cannot prove the DEFAULT arguments stay coupled to the real
 * `checkGrafanaConnectionDoctor` / `createGrafanaProviderAdapter` /
 * `assertWritableCapability`. RP-T2 in `./fault-injection.test.ts` narrows this for
 * the tenant scenario only: it drives the REAL default doctor into its accept branch
 * (`orgAllowlist: ["999"]`), so it dies under an always-refuse rewiring of the
 * default, and the pass-world `it.each` row dies under an always-accept one. What
 * survives every in-process test is a rewire to a BEHAVIOURALLY FAITHFUL FROZEN COPY
 * of the dependency. No equivalent narrowing exists for the `adapterFactory` or
 * `guard` defaults, and the org-allowlist deletion probe does NOT cover those two.
 * The coupling proof for that residual is the committed deletion-probe transcript
 * `docs/evidence/phase-21/fix-c5-oracle-pin-probe.txt` (re-runnable at any tree),
 * exactly as `docs/evidence/phase-21/fix-c5-tenant-boundary-probe.txt` is the
 * equivalent proof one layer up, at the gate.
 */

export interface ForgedDeleteScenarioOverrides {
  /** Defaults to the REAL `createGrafanaProviderAdapter`. Injected only by the reverse probes. */
  readonly adapterFactory?: (deps: GrafanaProviderAdapterDeps) => GrafanaProviderAdapter;
}

export function makeForgedDeleteAdminScenario(
  overrides: ForgedDeleteScenarioOverrides = {},
): FaultInjectionScenario {
  const adapterFactory = overrides.adapterFactory ?? createGrafanaProviderAdapter;
  return {
    name: "forged delete/admin call reaches zero outbound HTTP requests",
    category: "forged-delete-admin",
    run: async () => {
      const { send, calls } = neverCalledSend();
      const adapter = adapterFactory({
        externalConnectionId: "00000000-0000-4000-8000-000000000601",
        tenant: "tenant-1",
        envelopeId: "00000000-0000-4000-8000-000000000602",
        getSnapshot: async () => {
          throw new Error(
            "no writable snapshot needed — the forged call must fail before reaching it",
          );
        },
        send,
        payloadStore: new GrafanaPlanPayloadStore(),
        snapshotStore: new GrafanaRollbackSnapshotStore(),
      });
      const forgedDelete = (adapter as unknown as Record<string, unknown>).delete;
      const passed = typeof forgedDelete !== "function" && calls.length === 0;
      return {
        passed,
        detail: passed
          ? "no delete method exists; zero HTTP calls"
          : "unexpected delete capability",
      };
    },
  };
}

export interface TenantBoundaryScenarioOverrides {
  /** Defaults to the REAL `checkGrafanaConnectionDoctor`. Injected only by the reverse probes. */
  readonly doctor?: typeof checkGrafanaConnectionDoctor;
  /** Defaults to `["7"]` — the out-of-allowlist world the scenario constructs. RP-T2 injects `["999"]` to legitimise the token THROUGH the real default doctor. */
  readonly orgAllowlist?: readonly string[];
}

export function makeTenantBoundaryBreachScenario(
  overrides: TenantBoundaryScenarioOverrides = {},
): FaultInjectionScenario {
  const doctor = overrides.doctor ?? checkGrafanaConnectionDoctor;
  const orgAllowlist = overrides.orgAllowlist ?? ["7"];
  return {
    name: "a token bound to an out-of-allowlist org is refused before any resource access",
    category: "tenant-boundary",
    run: async () => {
      const result = await doctor({
        fetchTokenInfo: async () => ({ orgId: 999, role: "Admin" }),
        orgAllowlist,
      });
      return {
        passed: result.ok === false,
        detail: result.ok ? "tenant-boundary breach NOT refused" : "refused as expected",
      };
    },
  };
}

export interface RedactionScenarioOverrides {
  /** Defaults to the REAL `assertWritableCapability` — the import is now static rather than dynamic; the guard module is side-effect-free, so the runtime behaviour is unchanged. */
  readonly guard?: (snapshot: CapabilitySnapshot) => void;
}

export function makeRedactionCheckScenario(
  overrides: RedactionScenarioOverrides = {},
): FaultInjectionScenario {
  const guard = overrides.guard ?? assertWritableCapability;
  return {
    name: "a capability-snapshot-derived error never carries the connection's raw discovered resource list beyond documented fields",
    category: "redaction",
    run: async () => {
      const snapshot = CapabilitySnapshotSchema.parse({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "00000000-0000-4000-8000-000000000603",
        externalConnectionId: "00000000-0000-4000-8000-000000000604",
        product: "grafana",
        edition: "oss",
        version: "9.0.7",
        apiFamilies: [],
        resources: [...GRAFANA_RESOURCE_KINDS],
        actions: [],
        permissions: [],
        isReadOnly: true,
        discoveredAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      });
      let message = "";
      try {
        guard(snapshot);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      const passed = !message.includes("resources") && message.length > 0;
      return { passed, detail: message };
    },
  };
}

const forgedDeleteAdminScenario: FaultInjectionScenario = makeForgedDeleteAdminScenario();

const tenantBoundaryBreachScenario: FaultInjectionScenario = makeTenantBoundaryBreachScenario();

const redactionCheckScenario: FaultInjectionScenario = makeRedactionCheckScenario();

export const FAULT_INJECTION_MATRIX: readonly FaultInjectionScenario[] = [
  forgedDeleteAdminScenario,
  tenantBoundaryBreachScenario,
  redactionCheckScenario,
];
