import { describe, expect, it } from "vitest";
import { RemoteResourceSchema } from "@eo/contracts";
import { stampGrafanaRemoteResource } from "./stamp-grafana-remote-resource.js";

describe("stampGrafanaRemoteResource", () => {
  it("produces a schema-valid RemoteResource carrying the observed revision token", () => {
    const resource = stampGrafanaRemoteResource({
      externalConnectionId: "00000000-0000-4000-8000-000000000501",
      kind: "dashboard",
      externalId: "dash-uid-1",
      revision: "etag-42",
      observedAt: "2026-07-24T00:00:00.000Z",
      canonicalUrl: "https://grafana.example.com/d/dash-uid-1",
    });
    expect(() => RemoteResourceSchema.parse(resource)).not.toThrow();
    expect(resource.resourceKind).toBe("dashboard");
    expect(resource.revision).toBe("etag-42");
    expect(resource.externalId).toBe("dash-uid-1");
  });

  it("omits canonicalUrl when not supplied", () => {
    const resource = stampGrafanaRemoteResource({
      externalConnectionId: "00000000-0000-4000-8000-000000000502",
      kind: "alert-rule",
      externalId: "rule-1",
      revision: "1",
      observedAt: "2026-07-24T00:00:00.000Z",
    });
    expect(resource.canonicalUrl).toBeUndefined();
  });
});
