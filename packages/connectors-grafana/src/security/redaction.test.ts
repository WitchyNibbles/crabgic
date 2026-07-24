import { describe, expect, it } from "vitest";
import {
  REDACTED_PLACEHOLDER,
  redactCredentialShapedText,
  redactSecretBearingObject,
} from "./redaction.js";

describe("redactSecretBearingObject — recursive, key-driven redaction", () => {
  it("redacts a top-level secret-shaped key", () => {
    expect(redactSecretBearingObject({ password: "hunter2", name: "x" })).toEqual({
      password: REDACTED_PLACEHOLDER,
      name: "x",
    });
  });

  it("recurses into nested objects, redacting secret-shaped keys at any depth", () => {
    const input = {
      addresses: "a@example.com",
      auth: { username: "u", password: "hunter2" },
    };
    expect(redactSecretBearingObject(input)).toEqual({
      addresses: "a@example.com",
      auth: { username: "u", password: REDACTED_PLACEHOLDER },
    });
  });

  it("recurses into arrays of objects", () => {
    const input = [{ apiKey: "sk-123" }, { name: "safe" }];
    expect(redactSecretBearingObject(input)).toEqual([
      { apiKey: REDACTED_PLACEHOLDER },
      { name: "safe" },
    ]);
  });

  it("passes through primitives and null/undefined unchanged", () => {
    expect(redactSecretBearingObject("hello")).toBe("hello");
    expect(redactSecretBearingObject(42)).toBe(42);
    expect(redactSecretBearingObject(null)).toBeNull();
    expect(redactSecretBearingObject(undefined)).toBeUndefined();
  });

  it("redacts a webhook url field containing an embedded auth token when the KEY itself is secret-shaped", () => {
    const input = { url: "https://hooks.example.com/x", authorization: "Bearer sk-abcdef" };
    const redacted = redactSecretBearingObject(input) as Record<string, unknown>;
    expect(redacted.authorization).toBe(REDACTED_PLACEHOLDER);
    expect(redacted.url).toBe("https://hooks.example.com/x"); // non-secret-named key untouched
  });
});

describe("redactCredentialShapedText — content-pattern redaction for free-text fields (e.g. notification templates)", () => {
  it("redacts a Grafana Cloud service-account token embedded in free text", () => {
    const text = `Deploy with token glsa_abcdefghijklmnopqrst1234567890 please`;
    expect(redactCredentialShapedText(text)).not.toContain("glsa_abcdefghijklmnopqrst1234567890");
    expect(redactCredentialShapedText(text)).toContain(REDACTED_PLACEHOLDER);
  });

  it("redacts a Bearer token embedded in free text", () => {
    const text = "Authorization: Bearer sk-live-abcdefghijklmnop";
    expect(redactCredentialShapedText(text)).toContain(REDACTED_PLACEHOLDER);
    expect(redactCredentialShapedText(text)).not.toContain("sk-live-abcdefghijklmnop");
  });

  it("leaves ordinary Go-template syntax untouched (no false-positive redaction)", () => {
    const text = "{{ .CommonLabels.severity }} fired for {{ .CommonAnnotations.summary }}";
    expect(redactCredentialShapedText(text)).toBe(text);
  });
});
