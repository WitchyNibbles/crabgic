import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { evidenceClaimsStage, STAGE_NAME_EVIDENCE_CLAIMS } from "./evidence-claims.js";
import type { LintStageInput } from "./lint-types.js";

function stageInput(candidate: string): LintStageInput {
  return { candidate, kind: "review_comment", policy: DEFAULT_COMMUNICATION_POLICY };
}

describe("evidenceClaimsStage", () => {
  it("blocks a seeded unevidenced 'fixed' claim in a review comment", () => {
    const findings = evidenceClaimsStage(
      stageInput("finding: null deref; action: fixed the null check"),
    );
    expect(findings.length).toBe(1);
    expect(findings[0]!.stage).toBe(STAGE_NAME_EVIDENCE_CLAIMS);
    expect(findings[0]!.severity).toBe("block");
  });

  it("blocks every claim word without evidence", () => {
    for (const word of ["fixed", "resolved", "verified", "working", "completed"]) {
      const findings = evidenceClaimsStage(stageInput(`the issue is ${word} now`));
      expect(findings.length).toBe(1);
    }
  });

  it("allows a claim accompanied by an https URL", () => {
    expect(
      evidenceClaimsStage(stageInput("verified via https://ci.example.com/build/123")),
    ).toEqual([]);
  });

  it("allows a claim accompanied by a Jira-style ticket key", () => {
    expect(evidenceClaimsStage(stageInput("resolved in PROJ-456"))).toEqual([]);
  });

  it("allows a claim accompanied by an explicit evidence: marker", () => {
    expect(evidenceClaimsStage(stageInput("fixed the bug. evidence: test-run-2026-07-23"))).toEqual(
      [],
    );
  });

  it("allows text with no completion claims at all", () => {
    expect(evidenceClaimsStage(stageInput("investigating the null-deref in the parser"))).toEqual(
      [],
    );
  });

  it("blocks a claim next to a placeholder Evidence: line (e.g. 'none provided')", () => {
    const findings = evidenceClaimsStage(
      stageInput("Finding: null deref\nEvidence: none provided\nAction: fixed the null check"),
    );
    expect(findings.length).toBe(1);
  });

  it("blocks a claim next to other placeholder evidence contents", () => {
    for (const placeholder of ["none", "n/a", "tbd", "unknown"]) {
      const findings = evidenceClaimsStage(stageInput(`resolved. evidence: ${placeholder}`));
      expect(findings.length).toBe(1);
    }
  });

  it("blocks an unevidenced claim next to a standard/hash token that looks like a ticket key — M3 adversarial-review fixture", () => {
    for (const token of ["SHA-256", "COVID-19", "UTF-8"]) {
      const findings = evidenceClaimsStage(stageInput(`verified via ${token}`));
      expect(findings.length).toBe(1);
    }
  });

  it("still allows a claim accompanied by a real-looking Jira ticket key not on the denylist", () => {
    expect(evidenceClaimsStage(stageInput("resolved in PROJ-456"))).toEqual([]);
    expect(evidenceClaimsStage(stageInput("fixed, see JIRA-789"))).toEqual([]);
  });
});
