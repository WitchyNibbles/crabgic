import { describe, expect, it } from "vitest";
import { RemoteResourceSchema } from "./remote-resource.js";

const validResource = {
  schemaVersion: 1,
  id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
  externalConnectionId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  resourceKind: "issue",
  externalId: "PROJ-123",
  canonicalUrl: "https://example.atlassian.net/browse/PROJ-123",
  revision: "rev-17",
  observedAt: "2026-07-15T12:00:00.000Z",
};

describe("RemoteResourceSchema — valid fixture", () => {
  it("parses a fully-valid fixture (roadmap/18: revision comparator stamps RemoteResource)", () => {
    expect(RemoteResourceSchema.safeParse(validResource).success).toBe(true);
  });

  it("accepts a Grafana-shaped resource with no canonicalUrl", () => {
    const { canonicalUrl: _url, ...rest } = validResource;
    const grafanaDashboard = { ...rest, resourceKind: "dashboard", externalId: "dash-uid-abc123" };
    expect(RemoteResourceSchema.safeParse(grafanaDashboard).success).toBe(true);
  });
});

describe("RemoteResourceSchema — invalid-shape rejection", () => {
  it("rejects a missing schemaVersion", () => {
    const { schemaVersion: _schemaVersion, ...rest } = validResource;
    expect(RemoteResourceSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a non-uuid externalConnectionId", () => {
    expect(
      RemoteResourceSchema.safeParse({ ...validResource, externalConnectionId: "not-a-uuid" })
        .success,
    ).toBe(false);
  });

  it("rejects a malformed canonicalUrl", () => {
    expect(
      RemoteResourceSchema.safeParse({ ...validResource, canonicalUrl: "not-a-url" }).success,
    ).toBe(false);
  });

  it("rejects an empty revision", () => {
    expect(RemoteResourceSchema.safeParse({ ...validResource, revision: "" }).success).toBe(false);
  });

  it("rejects a malformed observedAt timestamp", () => {
    expect(
      RemoteResourceSchema.safeParse({ ...validResource, observedAt: "yesterday" }).success,
    ).toBe(false);
  });
});

describe("RemoteResourceSchema — unknown-key rejection (.strict())", () => {
  it("rejects an unknown top-level key", () => {
    expect(RemoteResourceSchema.safeParse({ ...validResource, unexpected: "field" }).success).toBe(
      false,
    );
  });

  it("rejects an embedded requirementId (linkage lives in the evidence_pointer journal entry, per roadmap/21, not on this record)", () => {
    expect(
      RemoteResourceSchema.safeParse({
        ...validResource,
        requirementId: "2c8e6b3a-2f8b-4b2a-9d7e-2f6a8e3b9c1d",
      }).success,
    ).toBe(false);
  });
});

describe("RemoteResourceSchema — round-trip", () => {
  it("parse -> JSON.stringify -> JSON.parse -> parse yields a deep-equal output", () => {
    const first = RemoteResourceSchema.parse(validResource);
    const roundTripped = RemoteResourceSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped).toStrictEqual(first);
  });
});
