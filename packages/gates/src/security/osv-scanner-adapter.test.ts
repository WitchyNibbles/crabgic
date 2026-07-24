import { describe, expect, it } from "vitest";
import { parseOsvScannerReport } from "./osv-scanner-adapter.js";
import { hasBlockingFinding } from "./types.js";

describe("parseOsvScannerReport — seeded-finding fixture: a known-CVE test double blocks", () => {
  it("normalizes a CRITICAL-severity known CVE to a blocking finding", () => {
    const fixture = {
      results: [
        {
          source: { path: "package-lock.json" },
          packages: [
            {
              package: { name: "left-pad-test-double", version: "0.0.1", ecosystem: "npm" },
              vulnerabilities: [
                { id: "CVE-2024-99999", database_specific: { severity: "CRITICAL" } },
              ],
            },
          ],
        },
      ],
    };
    const findings = parseOsvScannerReport(fixture);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.scanner).toBe("osv-scanner");
    expect(hasBlockingFinding(findings)).toBe(true);
  });

  it("maps OSV's 'MODERATE' to this package's 'medium' band (non-blocking)", () => {
    const fixture = {
      results: [
        {
          source: { path: "go.sum" },
          packages: [
            {
              package: { name: "example", version: "1.0.0", ecosystem: "Go" },
              vulnerabilities: [{ id: "GHSA-xxxx", database_specific: { severity: "MODERATE" } }],
            },
          ],
        },
      ],
    };
    const findings = parseOsvScannerReport(fixture);
    expect(findings[0]?.severity).toBe("medium");
    expect(hasBlockingFinding(findings)).toBe(false);
  });

  it("falls back to 'high' (never silently dropped) for an unrecognized severity string", () => {
    const fixture = {
      results: [
        {
          source: { path: "requirements.txt" },
          packages: [
            {
              package: { name: "example2", version: "2.0.0", ecosystem: "PyPI" },
              vulnerabilities: [{ id: "CVE-XXXX", database_specific: { severity: "WEIRD" } }],
            },
          ],
        },
      ],
    };
    const findings = parseOsvScannerReport(fixture);
    expect(findings[0]?.severity).toBe("high");
    expect(hasBlockingFinding(findings)).toBe(true);
  });
});
