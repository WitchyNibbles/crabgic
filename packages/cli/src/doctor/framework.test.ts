import { describe, expect, it } from "vitest";
import { buildRepairPlan, runDoctorChecks, type DoctorCheck } from "./framework.js";

function makeCheck(overrides: Partial<DoctorCheck> & { id: string }): DoctorCheck {
  return {
    severity: "error",
    run: async () => ({ id: overrides.id, severity: "error", passed: true, evidence: "ok" }),
    ...overrides,
  };
}

describe("runDoctorChecks", () => {
  it("runs zero checks cleanly (a seeded fault fixture produces no finding when its check isn't registered yet)", async () => {
    const report = await runDoctorChecks([]);
    expect(report.findings).toEqual([]);
    expect(report.allPassed).toBe(true);
  });

  it("aggregates multiple passing checks", async () => {
    const report = await runDoctorChecks([makeCheck({ id: "a" }), makeCheck({ id: "b" })]);
    expect(report.allPassed).toBe(true);
    expect(report.findings).toHaveLength(2);
  });

  it("a failing check is reflected in allPassed", async () => {
    const failing = makeCheck({
      id: "bad",
      run: async () => ({ id: "bad", severity: "error", passed: false, evidence: "boom" }),
    });
    const report = await runDoctorChecks([makeCheck({ id: "good" }), failing]);
    expect(report.allPassed).toBe(false);
    expect(report.findings.map((f) => f.id)).toEqual(["good", "bad"]);
  });

  it("a check that throws is recorded as a failing finding rather than aborting the run", async () => {
    const throwing = makeCheck({
      id: "throws",
      run: () => {
        throw new Error("kaboom");
      },
    });
    const report = await runDoctorChecks([throwing, makeCheck({ id: "after" })]);
    expect(report.allPassed).toBe(false);
    expect(report.findings[0]).toMatchObject({ id: "throws", passed: false });
    expect(report.findings[0]!.evidence).toContain("kaboom");
    // The check registered after the throwing one still ran.
    expect(report.findings[1]).toMatchObject({ id: "after", passed: true });
  });
});

describe("buildRepairPlan", () => {
  it("is empty when every check passed", async () => {
    const report = await runDoctorChecks([makeCheck({ id: "a" })]);
    expect(buildRepairPlan(report)).toEqual([]);
  });

  it("lists only failing checks that carry a repair step, in order", async () => {
    const report = {
      allPassed: false,
      findings: [
        { id: "a", severity: "error" as const, passed: false, repairStep: "do X" },
        { id: "b", severity: "error" as const, passed: true, evidence: "ok" },
        { id: "c", severity: "warning" as const, passed: false, evidence: "meh" },
      ].map((f) => ({ evidence: "evidence", ...f })),
    };
    expect(buildRepairPlan(report)).toEqual(["[a] do X"]);
  });
});
