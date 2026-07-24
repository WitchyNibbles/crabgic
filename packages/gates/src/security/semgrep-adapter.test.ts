import { describe, expect, it } from "vitest";
import { parseSemgrepReport } from "./semgrep-adapter.js";
import { hasBlockingFinding } from "./types.js";

describe("parseSemgrepReport — seeded-finding fixture: an intentionally vulnerable pattern blocks", () => {
  it("maps an ERROR-severity finding to 'critical' (blocking)", () => {
    const fixture = {
      results: [
        {
          check_id: "javascript.lang.security.audit.sqli.node-sqli",
          path: "src/db.js",
          extra: { severity: "ERROR" as const, message: "SQL injection via string concatenation" },
        },
      ],
    };
    const findings = parseSemgrepReport(fixture);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.scanner).toBe("semgrep");
    expect(hasBlockingFinding(findings)).toBe(true);
  });

  it("maps WARNING/INFO to non-blocking severities", () => {
    const fixture = {
      results: [
        { check_id: "r1", path: "a.js", extra: { severity: "WARNING" as const, message: "m1" } },
        { check_id: "r2", path: "b.js", extra: { severity: "INFO" as const, message: "m2" } },
      ],
    };
    const findings = parseSemgrepReport(fixture);
    expect(hasBlockingFinding(findings)).toBe(false);
  });

  it("rejects a malformed report", () => {
    expect(() => parseSemgrepReport({ results: [{ bogus: true }] })).toThrow();
  });
});
