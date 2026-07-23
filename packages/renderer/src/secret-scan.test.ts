import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { secretScanStage, STAGE_NAME_SECRET_SCAN } from "./secret-scan.js";
import type { LintStageInput } from "./lint-types.js";

function stageInput(candidate: string): LintStageInput {
  return { candidate, kind: "review_comment", policy: DEFAULT_COMMUNICATION_POLICY };
}

describe("secretScanStage", () => {
  it("blocks an AWS-style access key in a review comment (failing-first fixture)", () => {
    const findings = secretScanStage(stageInput("finding: leaked key AKIAABCDEFGHIJKLMNOP in config"));
    expect(findings.length).toBe(1);
    expect(findings[0]!.stage).toBe(STAGE_NAME_SECRET_SCAN);
    expect(findings[0]!.severity).toBe("block");
    expect(findings[0]!.message).toMatch(/AWS-style access key/i);
  });

  it("blocks a PEM private-key header", () => {
    const findings = secretScanStage(stageInput("-----BEGIN RSA PRIVATE KEY-----\nMIIB..."));
    expect(findings.some((f) => f.message.match(/PEM private-key/i))).toBe(true);
  });

  it("blocks a PEM header with no algorithm prefix", () => {
    const findings = secretScanStage(stageInput("-----BEGIN PRIVATE KEY-----"));
    expect(findings.length).toBe(1);
  });

  it("blocks a postgres connection string with embedded credentials", () => {
    const findings = secretScanStage(stageInput("connect via postgres://admin:hunter2@db.internal:5432/app"));
    expect(findings.some((f) => f.message.match(/connection string/i))).toBe(true);
  });

  it("blocks a mongodb connection string with embedded credentials", () => {
    const findings = secretScanStage(stageInput("mongodb://user:pass@cluster0.example.net/prod"));
    expect(findings.length).toBe(1);
  });

  it("blocks a GitHub-style PAT", () => {
    const token = `ghp_${"a".repeat(36)}`;
    const findings = secretScanStage(stageInput(`token: ${token}`));
    expect(findings.some((f) => f.message.match(/personal access token/i))).toBe(true);
  });

  it("blocks a bearer token", () => {
    const findings = secretScanStage(stageInput("Authorization: Bearer abcdefghijklmnopqrstuvwx"));
    expect(findings.some((f) => f.message.match(/bearer/i))).toBe(true);
  });

  it("blocks a hyphenated Anthropic-style API key (sk-ant-*) — C1 adversarial-review fixture", () => {
    const key = "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234";
    const findings = secretScanStage(stageInput(`leaked: ${key}`));
    expect(findings.some((f) => f.message.match(/Anthropic/i))).toBe(true);
  });

  it("blocks a hyphenated OpenAI-style project API key (sk-proj-*) — C1 adversarial-review fixture", () => {
    const key = `sk-proj-${"a".repeat(40)}`;
    const findings = secretScanStage(stageInput(`leaked: ${key}`));
    expect(findings.some((f) => f.message.match(/OpenAI|project/i))).toBe(true);
  });

  it("blocks a generic hyphenated sk- secret key not matching a known vendor prefix", () => {
    const key = `sk-${"a".repeat(10)}-${"b".repeat(10)}`;
    const findings = secretScanStage(stageInput(`leaked: ${key}`));
    expect(findings.length).toBeGreaterThan(0);
  });

  it("blocks a GCP-style AIza API key — H1 adversarial-review fixture", () => {
    const key = "AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R";
    const findings = secretScanStage(stageInput(`leaked: ${key}`));
    expect(findings.some((f) => f.message.match(/GCP|Google/i))).toBe(true);
  });

  it("blocks a modern github_pat_ personal access token — H2 adversarial-review fixture", () => {
    const token = `github_pat_${"a".repeat(11)}_${"b".repeat(59)}`;
    const findings = secretScanStage(stageInput(`leaked: ${token}`));
    expect(findings.some((f) => f.message.match(/personal access token/i))).toBe(true);
  });

  it("blocks a raw JWT with no Bearer prefix — H2 adversarial-review fixture", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const findings = secretScanStage(stageInput(`leaked: ${jwt}`));
    expect(findings.some((f) => f.message.match(/JWT/i))).toBe(true);
  });

  it("allows clean review-comment text with no secrets", () => {
    expect(secretScanStage(stageInput("finding: missing null check; evidence: test.ts:42; action: add guard"))).toEqual(
      [],
    );
  });

  it("reports a correct span for the matched secret", () => {
    const text = "prefix AKIAABCDEFGHIJKLMNOP suffix";
    const findings = secretScanStage(stageInput(text));
    const finding = findings[0]!;
    expect(text.slice(finding.span!.start, finding.span!.end)).toBe("AKIAABCDEFGHIJKLMNOP");
  });
});
