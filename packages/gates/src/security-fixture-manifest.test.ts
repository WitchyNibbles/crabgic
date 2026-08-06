import { describe, expect, it } from "vitest";
import { ConnectorError } from "@crabgic/contracts";
import { createGateRegistry } from "./registry.js";
import {
  fail,
  grafanaTenantBoundaryVerify,
  jiraTenantBoundaryVerify,
  pass,
  registerSecurityFixtureManifest,
  REQUIRED_SECURITY_FIXTURE_IDS,
  SECURITY_FIXTURE_MANIFEST,
  verdictFromAssertion,
} from "./security-fixture-manifest.js";
import type { FaultInjectionScenario } from "@crabgic/connectors-grafana";
import type { JiraSecurityScenario } from "@crabgic/connectors-jira";

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

  it("T2 (superseded 2026-08-06 — see T2′): the original Grafana pin is still present", () => {
    // ── SUPERSEDED 2026-08-06 (Batch H).
    //
    // ⚠️ PRECISION, because "annotate, never rewrite" is a claim about the
    // PROSE and not about the code, and conflating the two would itself be an
    // overclaim. Exactly what was and was not preserved:
    //
    //  - PRESERVED VERBATIM: this test's original comment (quoted below,
    //    byte-for-byte) and the ruling comment in
    //    `./security-fixture-manifest.ts`, which is annotated with dated
    //    addenda and never edited.
    //  - CHANGED, necessarily: this test's ASSERTIONS and its TITLE. The old
    //    assertions (`toHaveLength(1)`, `REQUIRED_SECURITY_FIXTURE_IDS` NOT
    //    containing "jira-tenant-boundary") assert the negation of the current
    //    invariant, so they cannot be kept green; the old title stated that
    //    negation in a sentence, and a ✓ printed beside it in every CI job log
    //    would be a citation hazard in a repository that proves claims by
    //    quoting job-log lines. Both were replaced.
    //
    // What survives here is the WEAKER, still-true half of the original pin —
    // the Grafana entry is present, from phase 20 — so this row keeps naming
    // the residual's Grafana side. The live tenant-boundary invariant is T2′
    // immediately after; read both.
    //
    // ORIGINAL TITLE, verbatim:
    //   "T2: exactly ONE tenant-boundary entry exists, and it is phase 20's
    //    Grafana one (deliberate residual)"
    //
    // ORIGINAL COMMENT, verbatim:
    //   Residual pin, not an accident: phase 18 shipped no tenant-boundary fixture
    //   and no Jira/gateway tenant enforcement exists to gate, so a Jira entry
    //   would be dead code cited as a bearer. Re-adding one requires real
    //   Jira-side enforcement AND a deliberate edit here.
    //
    // WHY IT IS FLIPPED NOW, in the residual's own terms:
    //  - "no Jira/gateway tenant enforcement exists to gate" — false since
    //    PR #100: `refuseOutOfAllowlistTenant` in
    //    `packages/gateway/src/mutation-pipeline/mutation-pipeline.ts:458`
    //    is consulted as the first statement of `executeMutationPlan`
    //    (`:511`).
    //  - "phase 18 shipped no tenant-boundary fixture" — no longer true:
    //    `packages/connectors-jira/src/fixtures/tenant-boundary-scenario.ts`
    //    ships one, built from REAL Jira plan builders and driven through the
    //    REAL `executeMutationPlan`.
    //  - "would be dead code cited as a bearer" — the entry's coupling to the
    //    real enforcement is measured, not asserted: the deletion probe
    //    `docs/evidence/phase-21/fix-21c5-jira-tenant-boundary-probe-batchH.txt`
    //    reddens this file and the connector's own suite when the
    //    `:511` consultation is deleted and the workspace rebuilt.
    //
    // The pin did its job: it made re-adding a Jira entry impossible without
    // this block, which is precisely "a deliberate edit rather than a drift".
    //
    // What did NOT change, so nobody over-reads the flip: the enforcement is
    // still GATEWAY-owned and provider-agnostic. What phase 18 now owns is the
    // FIXTURE — which is what the manifest's ruling asked for.
    const tenantEntries = SECURITY_FIXTURE_MANIFEST.filter((e) => e.category === "tenant-boundary");
    expect(tenantEntries.map((e) => e.id)).toContain("grafana-tenant-boundary");
    expect(tenantEntries.find((e) => e.id === "grafana-tenant-boundary")!.sourcePhase).toBe("20");
  });

  it("T2': the tenant-boundary category is borne by TWO entries — phase 20's Grafana one and phase 18's Jira one (deliberate flip of T2's residual)", () => {
    const tenantEntries = SECURITY_FIXTURE_MANIFEST.filter((e) => e.category === "tenant-boundary");
    expect(tenantEntries.map((e) => e.id).sort()).toEqual([
      "grafana-tenant-boundary",
      "jira-tenant-boundary",
    ]);
    expect(tenantEntries.find((e) => e.id === "jira-tenant-boundary")!.sourcePhase).toBe("18");
    expect(tenantEntries.every((e) => e.blocking === true)).toBe(true);
    expect(REQUIRED_SECURITY_FIXTURE_IDS).toContain("jira-tenant-boundary");
    // The Grafana entry is NOT weakened by the addition — same id, same
    // source phase, same blocking flag it carried before Batch H.
    expect(REQUIRED_SECURITY_FIXTURE_IDS).toContain("grafana-tenant-boundary");
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

/**
 * The Jira half of the tenant-boundary category, added 2026-08-06 (Batch H).
 *
 * ⚠️ SAME LIMIT AS ABOVE, restated so this block cannot be mis-cited: T8/T9/T10
 * drive INJECTED scenarios and factories, so nothing in this file establishes
 * that the DEFAULT path of the shipped `jira-tenant-boundary` entry is coupled
 * to `packages/connectors-jira`'s real fixture or, through it, to
 * `refuseOutOfAllowlistTenant` in `@crabgic/gateway`. T7 narrows that (it runs
 * the shipped entry's default path end to end), but the coupling proof is the
 * committed deletion probe
 * `docs/evidence/phase-21/fix-21c5-jira-tenant-boundary-probe-batchH.txt`:
 * delete the `refuseOutOfAllowlistTenant` consultation in
 * `packages/gateway/src/mutation-pipeline/mutation-pipeline.ts`, REBUILD (the
 * connector imports the gateway from `dist/`), and this file goes red.
 */
describe("tenant-boundary gate — phase 18's Jira half is derived from a real Jira fixture", () => {
  const jiraEntry = () => SECURITY_FIXTURE_MANIFEST.find((e) => e.id === "jira-tenant-boundary")!;

  it("T7: the jira-tenant-boundary entry's verdict names 18's real scenario and evidences the positive control", async () => {
    const verdict = await jiraEntry().verify(STUB_GATE_CONTEXT);
    expect(verdict.passed).toBe(true);
    // The scenario's own name, from
    // `packages/connectors-jira/src/fixtures/tenant-boundary-scenario.ts`.
    expect(verdict.detail).toMatch(/out-of-allowlist tenant is refused/);
    // Occurs ONLY in the pass branch — the fail branches say "FAILED:" or
    // "positive control broken", never this. Asserted together with
    // `passed === true` so no single string can match both worlds.
    expect(verdict.detail).toMatch(/positive control discriminates/);
    // The pinned wording ruling (`external-connection.ts:122`): no detail
    // string may promise this.
    expect(verdict.detail).not.toMatch(/cross-tenant access is refused/);
  });

  it("T8: an empty tenant-boundary selection FAILS rather than passing vacuously over zero scenarios", async () => {
    const noTenantScenarios = [] as readonly JiraSecurityScenario[];
    const verdict = await jiraTenantBoundaryVerify(noTenantScenarios);
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain("no tenant-boundary scenario");
  });

  it("T9: an unrefused breach propagates — a failing scenario result FAILS the gate", async () => {
    const breachNotRefused: readonly JiraSecurityScenario[] = [
      {
        name: "stub Jira breach scenario",
        category: "tenant-boundary",
        run: async () => ({ passed: false, detail: "breach NOT refused" }),
      },
    ];
    const verdict = await jiraTenantBoundaryVerify(breachNotRefused);
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain("breach NOT refused");
    expect(verdict.detail).not.toMatch(/positive control discriminates/);
  });

  it("T10: a factory whose in-allowlist control STILL reports a refusal FAILS the gate — a refuse-everything enforcement is not a passing tenant boundary", async () => {
    const alwaysPassingScenario = () => ({
      name: "stub that reports a refusal no matter what tenant is declared",
      category: "tenant-boundary" as const,
      run: async () => ({ passed: true, detail: "stub always reports a refusal" }),
    });
    const verdict = await jiraTenantBoundaryVerify(undefined, alwaysPassingScenario);
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain("positive control broken");
  });

  it("T11 (control, green before AND after): the default path passes against intact enforcement", async () => {
    const verdict = await jiraTenantBoundaryVerify();
    expect(verdict.passed).toBe(true);
  });

  it("T12: a factory that reports success even under an EMPTY tenantAllowlist FAILS the gate — the second control, added because probe B2 measured the first one missing this", async () => {
    // Distinguished from T10 by which conjunct of the scenario it disables:
    // T10's stub ignores the DECLARED tenant, T12's ignores the ALLOWLIST. The
    // stub below is built so it passes T10's control (it reports no refusal
    // when a tenant is declared) and would still have slipped past the gate
    // before the fail-closed control existed.
    const allowlistBlindScenario = (
      overrides: {
        readonly declaredTenant?: string;
        readonly tenantAllowlist?: readonly string[];
      } = {},
    ) => ({
      name: "stub blind to the allowlist",
      category: "tenant-boundary" as const,
      run: async () => ({
        passed: overrides.declaredTenant === undefined,
        detail: "stub ignores tenantAllowlist entirely",
      }),
    });
    const verdict = await jiraTenantBoundaryVerify(undefined, allowlistBlindScenario);
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain("EMPTY tenantAllowlist");
  });
});
