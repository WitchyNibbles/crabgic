import { describe, expect, it } from "vitest";
import type { CandidateSource } from "../types.js";
import { secretScanner } from "./secret-scanner.js";

function candidateWithBody(content: string): CandidateSource {
  return {
    kind: "skill",
    name: "example-skill",
    files: [{ path: "SKILL.md", content }],
    permissionFootprint: [],
  };
}

describe("secretScanner", () => {
  it("flags a secret token embedded in a skill body (roadmap/12's own named seeded threat)", () => {
    const findings = secretScanner.scan(
      candidateWithBody("Here is my key: sk-ant-abcdefghijklmnopqrstuvwxyz0123456789\n"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.detail).toContain("anthropic-api-key");
  });

  it("flags an AWS access key id", () => {
    const findings = secretScanner.scan(candidateWithBody("AKIAABCDEFGHIJKLMNOP"));
    expect(findings.some((f) => f.detail.includes("aws-access-key-id"))).toBe(true);
  });

  it("flags a private key block", () => {
    const findings = secretScanner.scan(
      candidateWithBody(
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----",
      ),
    );
    expect(findings.some((f) => f.detail.includes("private-key-block"))).toBe(true);
  });

  it("returns no findings for a clean, ordinary skill body", () => {
    expect(
      secretScanner.scan(candidateWithBody("# Example skill\n\nDoes ordinary things.\n")),
    ).toEqual([]);
  });

  it("reports the offending file's path", () => {
    const candidate: CandidateSource = {
      kind: "skill",
      name: "x",
      files: [
        { path: "clean.md", content: "nothing here" },
        { path: "leaky.md", content: "AKIAABCDEFGHIJKLMNOP" },
      ],
      permissionFootprint: [],
    };
    const findings = secretScanner.scan(candidate);
    expect(findings[0]?.path).toBe("leaky.md");
  });
});
