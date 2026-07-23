import { describe, expect, it } from "vitest";
import { ConnectorError } from "@eo/contracts";
import { mapHttpStatusToConnectorError, mapUnknownErrorToConnectorError } from "./error-mapping.js";

describe("mapHttpStatusToConnectorError", () => {
  const CASES: ReadonlyArray<readonly [number, ConnectorError["kind"]]> = [
    [401, "authentication"],
    [403, "permission"],
    [404, "not_found"],
    [409, "conflict"],
    [412, "conflict"],
    [429, "rate_limited"],
    [400, "validation"],
    [422, "validation"],
    [501, "unsupported"],
    [500, "transient"],
    [502, "transient"],
    [503, "transient"],
    [418, "transient"], // unmapped status falls back to transient
  ];

  it.each(CASES)("maps status %d to kind %s", (status, expectedKind) => {
    const err = mapHttpStatusToConnectorError({ status, provider: "jira", rawProviderResponse: { secret: "leak" } });
    expect(err.kind).toBe(expectedKind);
    expect(err).toBeInstanceOf(ConnectorError);
  });

  it("never leaks the raw provider response on the returned error", () => {
    const err = mapHttpStatusToConnectorError({
      status: 401,
      provider: "jira",
      rawProviderResponse: { apiToken: "super-secret-value" },
    });
    const serialized = JSON.stringify(err.toData());
    expect(serialized).not.toContain("super-secret-value");
  });
});

describe("mapUnknownErrorToConnectorError", () => {
  it("passes through an existing ConnectorError unchanged", () => {
    const original = ConnectorError.rateLimited({ message: "x", provider: "jira", retryable: true });
    expect(mapUnknownErrorToConnectorError(original, "jira")).toBe(original);
  });

  it("wraps a generic Error as transient, with the redacted-detail summary carrying no raw fields", () => {
    const err = mapUnknownErrorToConnectorError(new Error("ECONNRESET"), "jira");
    expect(err.kind).toBe("transient");
    expect(err.retryable).toBe(true);
    // redactedDetail is derived from rawProviderResponse via top-level key
    // names only (see ConnectorError's own redaction discipline) — a bare
    // Error instance has no enumerable own keys, so the summary is empty.
    expect(err.redactedDetail).toContain("none");
  });

  it("wraps a non-Error thrown value", () => {
    const err = mapUnknownErrorToConnectorError("plain string failure", "grafana");
    expect(err.kind).toBe("transient");
  });
});
