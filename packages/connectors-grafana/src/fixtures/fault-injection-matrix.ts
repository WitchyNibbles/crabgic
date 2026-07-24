import { CapabilitySnapshotSchema, CURRENT_SCHEMA_VERSION } from "@eo/contracts";
import { createGrafanaProviderAdapter } from "../adapter.js";
import { checkGrafanaConnectionDoctor } from "../auth/connection-doctor.js";
import { GrafanaPlanPayloadStore } from "../mutation/plan-payload-store.js";
import { GrafanaRollbackSnapshotStore } from "../mutation/snapshot-store.js";
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

const forgedDeleteAdminScenario: FaultInjectionScenario = {
  name: "forged delete/admin call reaches zero outbound HTTP requests",
  category: "forged-delete-admin",
  run: async () => {
    const { send, calls } = neverCalledSend();
    const adapter = createGrafanaProviderAdapter({
      baseUrl: "https://fake-grafana.invalid",
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
      detail: passed ? "no delete method exists; zero HTTP calls" : "unexpected delete capability",
    };
  },
};

const tenantBoundaryBreachScenario: FaultInjectionScenario = {
  name: "a token bound to an out-of-allowlist org is refused before any resource access",
  category: "tenant-boundary",
  run: async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: async () => ({ orgId: 999, role: "Admin" }),
      orgAllowlist: ["7"],
    });
    return {
      passed: result.ok === false,
      detail: result.ok ? "tenant-boundary breach NOT refused" : "refused as expected",
    };
  },
};

const redactionCheckScenario: FaultInjectionScenario = {
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
    const { assertWritableCapability } = await import("../mutation/write-eligibility-guard.js");
    let message = "";
    try {
      assertWritableCapability(snapshot);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    const passed = !message.includes("resources") && message.length > 0;
    return { passed, detail: message };
  },
};

export const FAULT_INJECTION_MATRIX: readonly FaultInjectionScenario[] = [
  forgedDeleteAdminScenario,
  tenantBoundaryBreachScenario,
  redactionCheckScenario,
];
