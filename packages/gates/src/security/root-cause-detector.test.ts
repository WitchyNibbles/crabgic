import { describe, expect, it } from "vitest";
import { detectRootCausePolicyViolations } from "./root-cause-detector.js";
import { hasBlockingFinding } from "./types.js";

describe("detectRootCausePolicyViolations — disabled-check diff fixture", () => {
  it("flags a commented-out assertion as advisory (medium) by default", () => {
    const diff = ["--- a/test.ts", "+++ b/test.ts", "+  // assert(result === expected);"].join(
      "\n",
    );
    const findings = detectRootCausePolicyViolations(diff);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("medium");
    expect(hasBlockingFinding(findings)).toBe(false);
  });

  it("flags a bare 'except:' clause, elevated to blocking when options.blocking is true", () => {
    const diff = [
      "+def handler():",
      "+    try:",
      "+        risky()",
      "+    except:",
      "+        pass",
    ].join("\n");
    const findings = detectRootCausePolicyViolations(diff, { blocking: true });
    expect(findings.some((f) => f.detail.includes("bare-except"))).toBe(true);
    expect(hasBlockingFinding(findings)).toBe(true);
  });

  it("flags a broad 'except Exception:' swallow", () => {
    const diff = "+    except Exception:";
    const findings = detectRootCausePolicyViolations(diff, { blocking: true });
    expect(findings.some((f) => f.detail.includes("broad-exception-swallow"))).toBe(true);
  });

  it("flags an empty catch block (hidden fallback)", () => {
    const diff = "+  } catch (e) {}";
    const findings = detectRootCausePolicyViolations(diff, { blocking: true });
    expect(findings.some((f) => f.detail.includes("hidden-fallback-empty-catch"))).toBe(true);
  });

  it("ignores removed/context lines and the '+++' file header", () => {
    const diff = ["--- a/x.ts", "+++ b/x.ts", "-  // assert(old);", "   const untouched = 1;"].join(
      "\n",
    );
    expect(detectRootCausePolicyViolations(diff)).toEqual([]);
  });

  it("a clean diff with no policy-violating patterns yields zero findings", () => {
    const diff = "+  const result = computeSomething();\n+  assert(result === expected);";
    expect(detectRootCausePolicyViolations(diff)).toEqual([]);
  });
});
