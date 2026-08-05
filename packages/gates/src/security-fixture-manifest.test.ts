import { describe, expect, it } from "vitest";
import { ConnectorError } from "@crabgic/contracts";
import { createGateRegistry } from "./registry.js";
import {
  fail,
  grafanaTenantBoundaryVerify,
  pass,
  registerSecurityFixtureManifest,
  REQUIRED_SECURITY_FIXTURE_IDS,
  SECURITY_FIXTURE_MANIFEST,
  verdictFromAssertion,
} from "./security-fixture-manifest.js";
import type { FaultInjectionScenario } from "@crabgic/connectors-grafana";

/**
 * roadmap/21 work item 6 failing-first: "a manifest-completeness test
 * (asserting all named fixtures present) is written before the
 * registrations exist, so it fails first." §Exit criteria: "16/18/20's
 * security fixtures (forged admin/delete, tenant boundary, redaction) are
 * present as blocking entries in 14's gate manifest; removing one fails
 * the manifest-completeness test."
 */

function assertManifestComplete(manifest: typeof SECURITY_FIXTURE_MANIFEST): void {
  const ids = new Set(manifest.map((e) => e.id));
  for (const requiredId of REQUIRED_SECURITY_FIXTURE_IDS) {
    if (!ids.has(requiredId)) {
      throw new Error(`security fixture manifest missing required entry: ${requiredId}`);
    }
  }
  for (const entry of manifest) {
    if (entry.blocking !== true) {
      throw new Error(`security fixture manifest entry "${entry.id}" is not blocking`);
    }
  }
}

describe("security fixture manifest — completeness", () => {
  it("contains every required fixture id, all marked blocking", () => {
    expect(() => assertManifestComplete(SECURITY_FIXTURE_MANIFEST)).not.toThrow();
    expect(SECURITY_FIXTURE_MANIFEST).toHaveLength(REQUIRED_SECURITY_FIXTURE_IDS.length);
  });

  it("covers all three named categories (forged admin/delete, tenant boundary, redaction) from all of 16/18/20", () => {
    const categories = new Set(SECURITY_FIXTURE_MANIFEST.map((e) => e.category));
    expect(categories).toEqual(new Set(["forged-admin-delete", "tenant-boundary", "redaction"]));
    const sourcePhases = new Set(SECURITY_FIXTURE_MANIFEST.map((e) => e.sourcePhase));
    expect(sourcePhases).toEqual(new Set(["16", "18", "20"]));
  });

  it("failing-first proof: removing any ONE required entry fails the completeness check", () => {
    for (const idToRemove of REQUIRED_SECURITY_FIXTURE_IDS) {
      const withOneRemoved = SECURITY_FIXTURE_MANIFEST.filter((e) => e.id !== idToRemove);
      expect(() => assertManifestComplete(withOneRemoved)).toThrow(idToRemove);
    }
  });

  it("registerSecurityFixtureManifest registers every entry into the registry's shared `security` tag", () => {
    const registry = createGateRegistry();
    registerSecurityFixtureManifest(registry);
    const registered = registry.list("security").map((g) => g.name);
    for (const requiredId of REQUIRED_SECURITY_FIXTURE_IDS) {
      expect(registered).toContain(requiredId);
    }
  });
});

describe("pass/fail verdict builders", () => {
  it("pass() builds a passed=true GateVerdict", () => {
    const v = pass("cmd", "ok");
    expect(v.passed).toBe(true);
    expect(v.exitStatus).toBe(0);
    expect(v.detail).toBe("ok");
  });

  it("fail() builds a passed=false GateVerdict", () => {
    const v = fail("cmd", "bad");
    expect(v.passed).toBe(false);
    expect(v.exitStatus).toBe(1);
    expect(v.detail).toBe("bad");
  });
});

describe("verdictFromAssertion — all three branches", () => {
  it("passes when the assertion throws a ConnectorError (the expected refusal)", () => {
    const v = verdictFromAssertion(
      "cmd",
      () => {
        throw ConnectorError.policyBlocked({ message: "m", provider: "p", retryable: false });
      },
      "expected refusal",
    );
    expect(v.passed).toBe(true);
  });

  it("fails when the assertion does NOT throw at all", () => {
    const v = verdictFromAssertion("cmd", () => undefined, "expected refusal");
    expect(v.passed).toBe(false);
    expect(v.detail).toContain("expected a refusal");
  });

  it("re-throws when the assertion throws something OTHER than a ConnectorError", () => {
    expect(() =>
      verdictFromAssertion(
        "cmd",
        () => {
          throw new Error("not a ConnectorError");
        },
        "expected refusal",
      ),
    ).toThrow("not a ConnectorError");
  });
});

const STUB_GATE_CONTEXT = {
  stage: "final_verifying",
  changeSetId: "00000000-0000-4000-8000-000000000001",
  objectId: "obj",
  journal: undefined as never,
} as const;

describe("security fixture manifest — each entry's verify handler is a REAL, live check (not a stub)", () => {
  it.each(SECURITY_FIXTURE_MANIFEST.map((e) => e.id))(
    "%s passes when invoked directly",
    async (id) => {
      const entry = SECURITY_FIXTURE_MANIFEST.find((e) => e.id === id)!;
      const verdict = await entry.verify(STUB_GATE_CONTEXT);
      expect(verdict.passed).toBe(true);
    },
  );
});

/**
 * Defect `21-tenant-boundary-manifest-entries-tautological` — the tenant-boundary
 * gate must be derived from real enforcement, not from two string literals.
 *
 * ⚠️ WHAT THIS SUITE CANNOT PROVE, STATED SO NOBODY MIS-CITES IT. T4/T5/T6 drive
 * INJECTED stubs and T1 matches a string, so the tests in this file alone cannot
 * establish that the DEFAULT path of the shipped manifest entry is coupled to
 * `packages/connectors-grafana`'s real `checkGrafanaConnectionDoctor`. A
 * regression could rewire the default arguments (say, to a frozen copy of the
 * matrix) and every test here would stay green. The coupling proof is the
 * committed deletion probe `docs/evidence/phase-21/fix-c5-tenant-boundary-probe.txt`:
 * delete `connection-doctor.ts`'s org-allowlist enforcement, rebuild, and this
 * file goes red (the `grafana-tenant-boundary` it.each row + T1). Cite that
 * transcript for coupling; cite these tests only for the shapes they assert.
 */
describe("tenant-boundary gate is derived from phase 20's real breach scenario", () => {
  it("T1: the grafana-tenant-boundary entry's verdict names 20's real scenario, not a gates-local literal comparison", async () => {
    const entry = SECURITY_FIXTURE_MANIFEST.find((e) => e.id === "grafana-tenant-boundary")!;
    const verdict = await entry.verify(STUB_GATE_CONTEXT);
    expect(verdict.passed).toBe(true);
    // The scenario's own name (fault-injection-matrix.ts:62). Deliberately NOT
    // "refused as expected", which occurs in the tautological detail too and so
    // would be green on both the old and the new implementation.
    expect(verdict.detail).toMatch(/out-of-allowlist org/);
  });

  it("T2: exactly ONE tenant-boundary entry exists, and it is phase 20's Grafana one (deliberate residual)", () => {
    // Residual pin, not an accident: phase 18 shipped no tenant-boundary fixture
    // and no Jira/gateway tenant enforcement exists to gate, so a Jira entry
    // would be dead code cited as a bearer. Re-adding one requires real
    // Jira-side enforcement AND a deliberate edit here.
    const tenantEntries = SECURITY_FIXTURE_MANIFEST.filter((e) => e.category === "tenant-boundary");
    expect(tenantEntries).toHaveLength(1);
    expect(tenantEntries[0]!.id).toBe("grafana-tenant-boundary");
    expect(tenantEntries[0]!.sourcePhase).toBe("20");
    expect(REQUIRED_SECURITY_FIXTURE_IDS).not.toContain("jira-tenant-boundary");
  });

  it("T3 (control, green before AND after — rules out a fail-everything implementation): the default path passes against intact enforcement", async () => {
    const verdict = await grafanaTenantBoundaryVerify();
    expect(verdict.passed).toBe(true);
  });

  it("T4: an empty tenant-boundary selection FAILS rather than passing vacuously over zero scenarios", async () => {
    const noTenantScenarios: readonly FaultInjectionScenario[] = [
      {
        name: "unrelated",
        category: "redaction",
        run: async () => ({ passed: true, detail: "irrelevant" }),
      },
    ];
    const verdict = await grafanaTenantBoundaryVerify(noTenantScenarios);
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain("no tenant-boundary scenario");
  });

  it("T5: an unrefused breach propagates — a failing scenario result FAILS the gate", async () => {
    const breachNotRefused: readonly FaultInjectionScenario[] = [
      {
        name: "stub breach scenario",
        category: "tenant-boundary",
        run: async () => ({ passed: false, detail: "breach NOT refused" }),
      },
    ];
    const verdict = await grafanaTenantBoundaryVerify(breachNotRefused);
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain("breach NOT refused");
  });

  it("T6: an always-refuse doctor FAILS the gate — a refuse-everything enforcement is not a passing tenant boundary", async () => {
    const alwaysRefuse = async () => ({ ok: false as const, reason: "stub refuses everything" });
    const verdict = await grafanaTenantBoundaryVerify(undefined, alwaysRefuse);
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain("positive control");
  });
});
