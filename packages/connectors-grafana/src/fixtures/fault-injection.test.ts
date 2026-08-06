import { describe, expect, it } from "vitest";
import {
  FAULT_INJECTION_MATRIX,
  makeForgedDeleteAdminScenario,
  makeRedactionCheckScenario,
  makeTenantBoundaryBreachScenario,
  neverCalledSend,
} from "./fault-injection-matrix.js";
import { createGrafanaProviderAdapter } from "../adapter.js";
import type { GrafanaProviderAdapter } from "../adapter.js";

describe("FAULT_INJECTION_MATRIX — every scenario self-verifies as passing", () => {
  it("covers all 3 named categories", () => {
    const categories = new Set(FAULT_INJECTION_MATRIX.map((s) => s.category));
    expect([...categories].sort()).toEqual(["forged-delete-admin", "redaction", "tenant-boundary"]);
  });

  it.each(FAULT_INJECTION_MATRIX.map((s) => [s.name, s] as const))(
    "%s",
    async (_name, scenario) => {
      const result = await scenario.run();
      expect(result.passed, result.detail).toBe(true);
    },
  );
});

describe("neverCalledSend — the test-support helper itself, exercised directly", () => {
  it("records any call made to it and returns a 200 (used only to detect a regression, never expected to fire)", async () => {
    const { send, calls } = neverCalledSend();
    const response = await send({ method: "DELETE", path: "/api/folders/x" });
    expect(response.status).toBe(200);
    expect(calls).toEqual([{ method: "DELETE", path: "/api/folders/x" }]);
  });
});

/**
 * Reverse probes for defect `20-fault-injection-scenarios-have-unpinned-oracles`.
 *
 * Attack G (2026-08-05) mutated `passed: result.ok === false` -> `passed: true`
 * inside `tenantBoundaryBreachScenario`'s own closure and 83 files / 660 tests
 * stayed green across `@crabgic/gates` + `@crabgic/connectors-grafana`: the gate
 * is a faithful reporter of whatever the scenario concludes, so nothing per-push
 * pinned the scenario's own verdict. The `it.each` rows above are the "does not
 * fail" pass-world controls; the rows below are the missing fail-world half.
 *
 * Every probe asserts the boolean AND the detail, and each asserted detail was
 * checked against the opposite outcome so it cannot match both worlds (playbook:
 * "a 'refused' assertion can match both the fix and the bug").
 */
describe("reverse probes — each scenario's verdict is DERIVED from its dependency, not a constant", () => {
  it("RP-T1: tenant scenario reports passed=false when the injected doctor ACCEPTS the out-of-allowlist token", async () => {
    const scenario = makeTenantBoundaryBreachScenario({
      doctor: async () => ({ ok: true, orgId: 999, role: "Admin" }),
    });
    const result = await scenario.run();
    expect(result.passed).toBe(false);
    // Exact match on the FAIL detail. The pass-world detail is "refused as
    // expected", which does not contain this string — and bare "refused" is
    // deliberately NOT the matcher, since it occurs in both worlds.
    expect(result.detail).toBe("tenant-boundary breach NOT refused");
  });

  it("RP-T2: through the REAL default doctor — an allowlist legitimising org 999 must flip the verdict to failed", async () => {
    // No doctor injected: this row exercises the DEFAULT dependency, so it
    // additionally dies if the default is ever rewired to an always-refuse stub
    // (see the residual comment in fault-injection-matrix.ts).
    const scenario = makeTenantBoundaryBreachScenario({ orgAllowlist: ["999"] });
    const result = await scenario.run();
    expect(result.passed).toBe(false);
    expect(result.detail).toBe("tenant-boundary breach NOT refused");
  });

  it("RP-F1: forged-delete scenario reports passed=false when the adapter surface exposes a delete method", async () => {
    const scenario = makeForgedDeleteAdminScenario({
      adapterFactory: (deps) => {
        const forged: GrafanaProviderAdapter & { readonly delete: () => Promise<void> } = {
          ...createGrafanaProviderAdapter(deps),
          delete: async () => undefined,
        };
        return forged;
      },
    });
    const result = await scenario.run();
    expect(result.passed).toBe(false);
    // Fail detail is "unexpected delete capability"; the pass detail is
    // "no delete method exists; zero HTTP calls" — neither contains the other.
    expect(result.detail).toBe("unexpected delete capability");
  });

  it("RP-F2: forged-delete scenario reports passed=false when adapter construction issues an HTTP call", async () => {
    const scenario = makeForgedDeleteAdminScenario({
      adapterFactory: (deps) => {
        void deps.send({ method: "DELETE", path: "/api/forged" });
        return createGrafanaProviderAdapter(deps);
      },
    });
    const result = await scenario.run();
    expect(result.passed).toBe(false);
    expect(result.detail).toBe("unexpected delete capability");
  });

  it("RP-R1: redaction scenario reports passed=false when the guard's error carries the raw resources list", async () => {
    const scenario = makeRedactionCheckScenario({
      guard: () => {
        throw new Error("read-only: resources [folder, dashboard] rejected");
      },
    });
    const result = await scenario.run();
    expect(result.passed).toBe(false);
    // Cannot match the pass world BY CONSTRUCTION: the verdict is
    // `!message.includes("resources") && message.length > 0`, so a passing run's
    // detail definitionally lacks "resources".
    expect(result.detail).toContain("resources");
  });

  it("RP-R2: redaction scenario reports passed=false when the guard does NOT refuse at all", async () => {
    const scenario = makeRedactionCheckScenario({ guard: () => undefined });
    const result = await scenario.run();
    expect(result.passed).toBe(false);
    // The no-refusal world's detail; the pass world's is the guard's non-empty message.
    expect(result.detail).toBe("");
  });
});
