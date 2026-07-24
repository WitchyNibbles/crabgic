import { describe, expect, it } from "vitest";
import { CapabilitySnapshotSchema } from "@eo/contracts";
import { GRAFANA_RESOURCE_KINDS, type GrafanaResourceKind } from "../resource-kinds.js";
import {
  BUILD_INFO_CLOUD_CURRENT,
  BUILD_INFO_OSS_11_6,
  BUILD_INFO_OSS_12_4,
  BUILD_INFO_OSS_13_1,
  BUILD_INFO_UNKNOWN,
  PINNED_BUILD_INFO_FIXTURES,
  type GrafanaBuildInfoFixture,
  type GrafanaRouteFamily,
} from "./build-info-fixtures.js";
import {
  buildGrafanaCapabilitySnapshotDiscoverer,
  discoverGrafanaCapabilities,
  isKnownGrafanaBuild,
  type GrafanaDiscoveryDeps,
} from "./capability-discovery.js";

function depsFromFixture(fixture: GrafanaBuildInfoFixture): GrafanaDiscoveryDeps {
  return {
    fetchBuildInfo: async () => fixture.buildInfo,
    probeRoute: async (kind: GrafanaResourceKind, family: GrafanaRouteFamily) =>
      fixture.routeAvailability[kind].includes(family),
  };
}

describe("isKnownGrafanaBuild", () => {
  it("recognizes each of the 4 pinned fixtures", () => {
    for (const fixture of PINNED_BUILD_INFO_FIXTURES) {
      expect(isKnownGrafanaBuild(fixture.buildInfo)).toBe(true);
    }
  });

  it("rejects an unrecognized OSS version", () => {
    expect(isKnownGrafanaBuild(BUILD_INFO_UNKNOWN.buildInfo)).toBe(false);
  });

  it("treats patch-version drift within a known major.minor as still known", () => {
    expect(isKnownGrafanaBuild({ product: "grafana", edition: "oss", version: "11.6.99" })).toBe(
      true,
    );
  });

  it("rejects a version string with no parseable leading major.minor at all", () => {
    expect(
      isKnownGrafanaBuild({ product: "grafana", edition: "oss", version: "unreleased-build" }),
    ).toBe(false);
  });
});

describe("discoverGrafanaCapabilities — per-fixture route selection (work item 2)", () => {
  it("11.6 discovers a fully legacy, writable snapshot", async () => {
    const result = await discoverGrafanaCapabilities(depsFromFixture(BUILD_INFO_OSS_11_6));
    expect(result.isReadOnly).toBe(false);
    expect(result.actions).toContain("create");
    expect(result.apiFamilies).toContain("folder:legacy");
    expect(result.apiFamilies).not.toContain("folder:apis");
  });

  it("12.4 discovers folder/dashboard on apis, a writable snapshot", async () => {
    const result = await discoverGrafanaCapabilities(depsFromFixture(BUILD_INFO_OSS_12_4));
    expect(result.apiFamilies).toContain("folder:apis");
    expect(result.apiFamilies).toContain("annotation:legacy");
    expect(result.isReadOnly).toBe(false);
  });

  it("13.1 and current-Cloud both discover the broader apis surface", async () => {
    for (const fixture of [BUILD_INFO_OSS_13_1, BUILD_INFO_CLOUD_CURRENT]) {
      const result = await discoverGrafanaCapabilities(depsFromFixture(fixture));
      expect(result.apiFamilies).toContain("annotation:apis");
      expect(result.isReadOnly).toBe(false);
    }
  });

  it("resources lists exactly the 7 kinds when every route is reachable", async () => {
    const result = await discoverGrafanaCapabilities(depsFromFixture(BUILD_INFO_OSS_13_1));
    expect([...result.resources].sort()).toEqual([...GRAFANA_RESOURCE_KINDS].sort());
  });
});

describe("unknown build forces read-only (exit criterion)", () => {
  it("an unrecognized build-info version is read-only even though every route probed as reachable", async () => {
    const result = await discoverGrafanaCapabilities(depsFromFixture(BUILD_INFO_UNKNOWN));
    expect(result.isReadOnly).toBe(true);
    expect(result.actions).not.toContain("create");
    expect(result.actions).not.toContain("update");
    // Route probing still succeeded (routes ARE reachable) — the read-only
    // verdict is independent of route availability, never derived from it.
    expect(result.resources.length).toBeGreaterThan(0);
  });
});

describe("adversarial-review LOW fix: build-info is zod-validated at the boundary, never trusted blind", () => {
  it("rejects a build-info response missing `version`", async () => {
    await expect(
      discoverGrafanaCapabilities({
        fetchBuildInfo: async () => ({ product: "grafana", edition: "oss" }) as never,
        probeRoute: async () => true,
      }),
    ).rejects.toThrow();
  });

  it("rejects an edition outside the 3-member enum", async () => {
    await expect(
      discoverGrafanaCapabilities({
        fetchBuildInfo: async () =>
          ({ product: "grafana", edition: "totally-made-up", version: "1.0" }) as never,
        probeRoute: async () => true,
      }),
    ).rejects.toThrow();
  });

  it("rejects a response reporting a different product", async () => {
    await expect(
      discoverGrafanaCapabilities({
        fetchBuildInfo: async () =>
          ({ product: "not-grafana", edition: "oss", version: "1.0" }) as never,
        probeRoute: async () => true,
      }),
    ).rejects.toThrow();
  });

  it("rejects extra unrecognized fields (strict shape) rather than silently ignoring them", async () => {
    await expect(
      discoverGrafanaCapabilities({
        fetchBuildInfo: async () =>
          ({ product: "grafana", edition: "oss", version: "13.1.0", extra: "unexpected" }) as never,
        probeRoute: async () => true,
      }),
    ).rejects.toThrow();
  });

  it('a well-formed edition:"cloud" response with an untested/arbitrary version STILL passes shape validation and is treated as known (documented design decision, not a validation gap)', async () => {
    const result = await discoverGrafanaCapabilities({
      fetchBuildInfo: async () => ({
        product: "grafana",
        edition: "cloud",
        version: "totally-arbitrary-tag",
      }),
      probeRoute: async () => true,
    });
    expect(result.isReadOnly).toBe(false);
    expect(result.version).toBe("totally-arbitrary-tag"); // the version is still recorded, never discarded
  });
});

describe("buildGrafanaCapabilitySnapshotDiscoverer — @eo/gateway DiscoverCapabilitySnapshot adapter", () => {
  it("produces a shape that round-trips through CapabilitySnapshotSchema once discoveredAt/expiresAt are added", async () => {
    const discoverer = buildGrafanaCapabilitySnapshotDiscoverer(() =>
      depsFromFixture(BUILD_INFO_OSS_13_1),
    );
    const partial = await discoverer("11111111-1111-4111-8111-111111111111");
    const full = {
      ...partial,
      discoveredAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    };
    expect(() => CapabilitySnapshotSchema.parse(full)).not.toThrow();
    expect(partial.externalConnectionId).toBe("11111111-1111-4111-8111-111111111111");
  });
});
