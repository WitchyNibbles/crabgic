import { describe, expect, it } from "vitest";
import { parseGitleaksReport } from "./gitleaks-adapter.js";
import { hasBlockingFinding } from "./types.js";

describe("parseGitleaksReport — seeded-finding fixture: a planted AWS-shaped test key blocks", () => {
  it("normalizes a planted AWS-shaped secret to a critical (blocking) finding", () => {
    const fixture = [
      {
        Description: "AWS Access Key",
        File: "src/config/test-fixture.env",
        RuleID: "aws-access-token",
        Match: "AKIAABCDEFGHIJKLMNOP",
      },
    ];
    const findings = parseGitleaksReport(fixture);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.scanner).toBe("gitleaks");
    expect(hasBlockingFinding(findings)).toBe(true);
  });

  it("an empty report yields no findings and does not block", () => {
    expect(hasBlockingFinding(parseGitleaksReport([]))).toBe(false);
  });

  it("rejects a malformed report", () => {
    expect(() => parseGitleaksReport([{ bogus: true }])).toThrow();
  });
});
