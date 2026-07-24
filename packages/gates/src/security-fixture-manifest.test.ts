import { describe, expect, it } from "vitest";
import { ConnectorError } from "@eo/contracts";
import { createGateRegistry } from "./registry.js";
import {
  fail,
  pass,
  registerSecurityFixtureManifest,
  REQUIRED_SECURITY_FIXTURE_IDS,
  SECURITY_FIXTURE_MANIFEST,
  verdictFromAssertion,
} from "./security-fixture-manifest.js";

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

describe("security fixture manifest — each entry's verify handler is a REAL, live check (not a stub)", () => {
  it.each(SECURITY_FIXTURE_MANIFEST.map((e) => e.id))(
    "%s passes when invoked directly",
    async (id) => {
      const entry = SECURITY_FIXTURE_MANIFEST.find((e) => e.id === id)!;
      const verdict = await entry.verify({
        stage: "final_verifying",
        changeSetId: "00000000-0000-4000-8000-000000000001",
        objectId: "obj",
        journal: undefined as never,
      });
      expect(verdict.passed).toBe(true);
    },
  );
});
