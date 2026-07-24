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
