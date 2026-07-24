import { describe, expect, it } from "vitest";
import type { CandidateSource } from "../types.js";
import { permissionScanner } from "./permission-scanner.js";

function candidateWithFootprint(permissionFootprint: string[]): CandidateSource {
  return {
    kind: "hook",
    name: "example-hook",
    files: [{ path: "hook.json", content: "{}" }],
    permissionFootprint,
  };
}

describe("permissionScanner", () => {
  it("flags an unscoped Bash(*) hook as critical (roadmap/12's own named seeded threat)", () => {
    const findings = permissionScanner.scan(candidateWithFootprint(["Bash(*)"]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("critical");
  });

  it("flags a bare wildcard '*' permission", () => {
    const findings = permissionScanner.scan(candidateWithFootprint(["*"]));
    expect(findings[0]?.severity).toBe("critical");
  });

  it("flags whole-home read as high", () => {
    const findings = permissionScanner.scan(candidateWithFootprint(["Read(~/**)"]));
    expect(findings[0]?.severity).toBe("high");
  });

  it("does not flag a narrowly-scoped permission", () => {
    expect(
      permissionScanner.scan(candidateWithFootprint(["Bash(git status)", "Read(./**)"])),
    ).toEqual([]);
  });
});
