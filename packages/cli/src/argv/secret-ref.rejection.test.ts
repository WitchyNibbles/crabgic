import { describe, expect, it } from "vitest";
import { SecretValueRejectedError } from "../errors.js";
import { isSecretShapedValue, parseSecretReference } from "./secret-reference.js";

describe("parseSecretReference", () => {
  it("accepts an env: reference", () => {
    expect(parseSecretReference("--token", "env:MY_JIRA_TOKEN")).toEqual({
      raw: "env:MY_JIRA_TOKEN",
    });
  });

  it("accepts an op:// reference", () => {
    expect(parseSecretReference("--token", "op://vault/item/field").raw).toBe(
      "op://vault/item/field",
    );
  });

  it("accepts a vault:// reference", () => {
    expect(parseSecretReference("--token", "vault://secret/data/jira").raw).toBe(
      "vault://secret/data/jira",
    );
  });

  it("accepts a file:// reference", () => {
    expect(parseSecretReference("--token", "file:///run/secrets/jira-token").raw).toBe(
      "file:///run/secrets/jira-token",
    );
  });

  it("accepts an opaque ref: reference", () => {
    expect(parseSecretReference("--token", "ref:conn-42").raw).toBe("ref:conn-42");
  });

  it("rejects a literal high-entropy token-shaped value", () => {
    expect(() => parseSecretReference("--token", "sk-ant-api03-abcdef0123456789")).toThrow(
      SecretValueRejectedError,
    );
  });

  it("rejects a bare JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGVzdHNpZ25hdHVyZQ";
    expect(() => parseSecretReference("--token", jwt)).toThrow(SecretValueRejectedError);
  });

  it("never echoes the rejected value in the thrown error message", () => {
    const secret = "ghp_thisIsNotARealTokenButLooksLikeOne1234";
    try {
      parseSecretReference("--token", secret);
      expect.unreachable("expected parseSecretReference to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SecretValueRejectedError);
      expect((err as Error).message).not.toContain(secret);
      expect((err as Error).message).toContain("--token");
    }
  });

  it("rejects plain non-reference garbage too (only recognized reference forms are accepted)", () => {
    expect(() => parseSecretReference("--token", "just-a-connection-name")).toThrow(
      SecretValueRejectedError,
    );
  });
});

describe("isSecretShapedValue", () => {
  it("is false for every recognized reference form", () => {
    for (const ref of ["env:FOO", "op://a/b/c", "vault://a/b", "file:///a/b", "ref:xyz"]) {
      expect(isSecretShapedValue(ref)).toBe(false);
    }
  });

  it("is true for known secret-provider prefixes", () => {
    expect(isSecretShapedValue("sk-abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(isSecretShapedValue("ghp_abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(isSecretShapedValue("AKIAABCDEFGHIJKLMNOP")).toBe(true);
    expect(isSecretShapedValue("-----BEGIN PRIVATE KEY-----")).toBe(true);
  });

  it("is false for short, ordinary words", () => {
    expect(isSecretShapedValue("jira")).toBe(false);
    expect(isSecretShapedValue("my-project")).toBe(false);
  });
});
