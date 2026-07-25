import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkSecurityReviewSignOff,
  isBlockingSeverity,
  parseFindingsTable,
  readSecurityReviewInput,
  type SecurityFinding,
} from "./securityReviewSignOff.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function finding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    surface: "Envelope compiler (§3)",
    severity: "CRITICAL",
    finding: "owned-path confinement escape",
    fix: "anchored ownedPaths to the worktree",
    evidence: "`docs/evidence/phase-03/README.md`",
    ...overrides,
  };
}

const ALWAYS_EXISTS = (): boolean => true;

function passingInput(findings: readonly SecurityFinding[] = [finding()]) {
  return {
    signOffSection: "No unresolved CRITICAL or HIGH security finding blocks this release.",
    findings,
    threatModelPresent: true,
    pathExists: ALWAYS_EXISTS,
  };
}

describe("parseFindingsTable", () => {
  it("parses data rows and skips the header and separator", () => {
    const section = [
      "| Surface | Severity | Finding | Fix | Evidence |",
      "| ------- | -------- | ------- | --- | -------- |",
      "| Renderer | CRITICAL | leak | widened pattern | `docs/evidence/phase-17/README.md` |",
    ].join("\n");
    const rows = parseFindingsTable(section);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.severity).toBe("CRITICAL");
    expect(rows[0]?.surface).toBe("Renderer");
  });

  it("ignores malformed rows rather than coercing them into findings", () => {
    expect(parseFindingsTable("| only | three | cells |")).toEqual([]);
    expect(parseFindingsTable("not a table row")).toEqual([]);
  });
});

describe("isBlockingSeverity", () => {
  it("treats CRITICAL and HIGH as blocking and others as not", () => {
    expect(isBlockingSeverity("CRITICAL")).toBe(true);
    expect(isBlockingSeverity("HIGH (validator-rated)")).toBe(true);
    expect(isBlockingSeverity("MEDIUM")).toBe(false);
    expect(isBlockingSeverity("MAJOR")).toBe(false);
  });
});

describe("checkSecurityReviewSignOff — PASS", () => {
  it("passes on a recorded sign-off with fixed, cross-referenced findings", () => {
    const result = checkSecurityReviewSignOff(passingInput());
    expect(result.verdict).toBe("PASS");
  });
});

describe("checkSecurityReviewSignOff — seeded defects each FAIL", () => {
  it("FAILs when no sign-off section is recorded", () => {
    const result = checkSecurityReviewSignOff({ ...passingInput(), signOffSection: undefined });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("sign-off is not recorded");
  });

  it("FAILs when the threat model is absent — a sign-off needs a baseline", () => {
    const result = checkSecurityReviewSignOff({ ...passingInput(), threatModelPresent: false });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("no baseline");
  });

  it("BLOCKS on an open CRITICAL finding — mirrors 14's gate semantics", () => {
    const result = checkSecurityReviewSignOff(passingInput([finding({ fix: "OPEN — deferred" })]));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("still open");
  });

  it("BLOCKS on a CRITICAL finding with no recorded fix at all", () => {
    const result = checkSecurityReviewSignOff(passingInput([finding({ fix: "" })]));
    expect(result.verdict).toBe("FAIL");
  });

  it("FAILs when a blocking finding records no cross-reference", () => {
    const result = checkSecurityReviewSignOff(passingInput([finding({ evidence: "" })]));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("no implementation cross-reference");
  });

  it("FAILs when a cross-reference does not resolve", () => {
    const result = checkSecurityReviewSignOff({ ...passingInput(), pathExists: () => false });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("do not resolve");
  });

  it("FAILs on zero parsed rows — never a vacuous PASS", () => {
    const result = checkSecurityReviewSignOff(passingInput([]));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("zero rows is treated as a broken");
  });

  /**
   * Regression, found by running this check against the real
   * `docs/security-posture.md`: a resolved gateway finding whose fix text
   * names the `pending → recorded/conflict/failed` state machine was scored
   * "still open", because the state name `pending` matched the
   * unresolved-status marker. A code span names an identifier; only prose
   * asserts status.
   */
  it("does not read a state name inside a code span as an unresolved status", () => {
    const result = checkSecurityReviewSignOff(
      passingInput([
        finding({ fix: "`mutation-pipeline.ts` now owns the full `pending → recorded` machine" }),
      ]),
    );
    expect(result.verdict).toBe("PASS");
  });

  it("does not read an incidental state word mid-sentence as an unresolved status", () => {
    // Second half of the same real-world regression: the fix text also says
    // "the same operationId for the pending write" — prose, not a code span,
    // but still a state name rather than a claim about the finding.
    const result = checkSecurityReviewSignOff(
      passingInput([finding({ fix: "reuses the same operationId for the pending write" })]),
    );
    expect(result.verdict).toBe("PASS");
  });

  it("still blocks on an explicit unresolved phrase", () => {
    const result = checkSecurityReviewSignOff(
      passingInput([finding({ fix: "still open, awaiting a follow-up patch" })]),
    );
    expect(result.verdict).toBe("FAIL");
  });

  it("still blocks on a status marker leading the cell", () => {
    const result = checkSecurityReviewSignOff(
      passingInput([finding({ fix: "PENDING a follow-up patch" })]),
    );
    expect(result.verdict).toBe("FAIL");
  });

  it("ignores non-blocking severities when scoring", () => {
    const result = checkSecurityReviewSignOff(
      passingInput([finding({ severity: "MEDIUM", fix: "OPEN", evidence: "" })]),
    );
    expect(result.verdict).toBe("PASS");
  });
});

describe("readSecurityReviewInput — against the real repository", () => {
  it("finds the real sign-off, threat model, and findings table", () => {
    const input = readSecurityReviewInput(REPO_ROOT);
    expect(input.threatModelPresent).toBe(true);
    expect(input.signOffSection).toBeDefined();
    expect(input.findings.length).toBeGreaterThan(0);
  });
});
