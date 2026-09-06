import { describe, expect, it } from "vitest";
import { containsSecretShapedContent } from "./secret-patterns.js";

describe("containsSecretShapedContent", () => {
  it("detects an AWS-style access key id", () => {
    expect(containsSecretShapedContent("key: AKIAABCDEFGHIJKLMNOP")).toBe(true);
  });

  it("detects a PEM private-key header", () => {
    expect(containsSecretShapedContent("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
  });

  it("detects an aws_secret_access_key assignment", () => {
    expect(containsSecretShapedContent("aws_secret_access_key = abc123")).toBe(true);
  });

  it("returns false for ordinary text", () => {
    expect(containsSecretShapedContent("just a normal comment about the fix")).toBe(false);
  });
});

/**
 * ⚠️ THE SIBLING CONNECTOR CATCHES MORE, doing the same job. Grafana's
 * `CREDENTIAL_SHAPED_CONTENT_PATTERNS` (`@crabgic/connectors-grafana`'s
 * `security/redaction.ts`) carries `Bearer …`, a JWT triple and its own
 * vendor prefix `glsa_` alongside `AKIA`. This set carried `AKIA` alone, so
 * the SAME worker-authored text was redacted on its way to Grafana and posted
 * verbatim to Jira.
 *
 * Measured 2026-09-06: of eight credential shapes, seven passed this guard —
 * including a GitHub PAT and an Anthropic key, both of which this project's own
 * environment holds, and an Atlassian token, which is the credential this very
 * connector authenticates with.
 *
 * ⚠️ EVERY PATTERN BELOW IS SERIALIZATION-SAFE, per this module's own
 * constraint: none depends on a literal newline, tab, quote or backslash, so
 * each matches on the extracted-text scan AND on the `JSON.stringify` scan
 * `adf-guard.ts` runs second. `Bearer\s+` is the only one touching `\s`, and
 * it matches the space that survives JSON encoding unchanged.
 */
describe("credential shapes the Grafana connector already refuses", () => {
  it.each([
    ["a bearer header", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345"],
    [
      "a JWT",
      "token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    ],
  ])("detects %s", (_label, text) => {
    expect(containsSecretShapedContent(text)).toBe(true);
  });
});

/**
 * The credentials THIS repository's own workers hold, plus the one this
 * connector authenticates with. A worker pasting a failing command's output
 * into a Jira comment is the ordinary path by which each of these reaches here.
 */
describe("credential shapes this project's own environment holds", () => {
  it.each([
    ["a classic GitHub PAT", `ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`],
    ["a fine-grained GitHub PAT", `github_pat_${"A".repeat(22)}_${"B".repeat(59)}`],
    ["an Anthropic API key", `sk-ant-api03-${"x".repeat(40)}`],
    ["an Atlassian API token", `ATATT3xFfGF0${"x".repeat(50)}`],
  ])("detects %s", (_label, text) => {
    expect(containsSecretShapedContent(`see log: ${text}`)).toBe(true);
  });

  /** The false-positive direction, which is what keeps the patterns narrow. */
  it.each([
    ["a sentence mentioning a bearer", "the bearer of this ticket should retest"],
    ["a base64-ish word", "eyJ is how a JWT starts, but this is prose"],
    ["a branch name", "fix/github-pat-rotation"],
    ["an ordinary token word", "the token bucket refills every second"],
  ])("does not fire on %s", (_label, text) => {
    expect(containsSecretShapedContent(text)).toBe(false);
  });
});
