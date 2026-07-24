import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { GRAFANA_RESOURCE_KINDS, type GrafanaResourceKind } from "../resource-kinds.js";
import {
  BUILD_INFO_CLOUD_CURRENT,
  BUILD_INFO_OSS_11_6,
  BUILD_INFO_OSS_12_4,
  BUILD_INFO_OSS_13_1,
  PINNED_BUILD_INFO_FIXTURES,
  type GrafanaBuildInfoFixture,
} from "./build-info-fixtures.js";
import {
  buildRouteTable,
  capabilityFlag,
  decodeApiFamiliesToRouteTable,
  encodeRouteTableToApiFamilies,
  selectRouteFamily,
  type CapabilityFlagSet,
} from "./route-table.js";

function flagsFromFixture(fixture: GrafanaBuildInfoFixture): CapabilityFlagSet {
  const flags = new Set<string>();
  for (const kind of GRAFANA_RESOURCE_KINDS) {
    for (const family of fixture.routeAvailability[kind]) {
      flags.add(capabilityFlag(kind, family));
    }
  }
  return flags;
}

describe("route selection per pinned build-info fixture (work item 2)", () => {
  it("11.6: every kind resolves to legacy", () => {
    const table = buildRouteTable(flagsFromFixture(BUILD_INFO_OSS_11_6));
    for (const kind of GRAFANA_RESOURCE_KINDS) {
      expect(table[kind]?.family).toBe("legacy");
    }
  });

  it("12.4: folder/dashboard resolve to apis; everything else legacy", () => {
    const table = buildRouteTable(flagsFromFixture(BUILD_INFO_OSS_12_4));
    expect(table.folder?.family).toBe("apis");
    expect(table.dashboard?.family).toBe("apis");
    expect(table.annotation?.family).toBe("legacy");
    expect(table["alert-rule"]?.family).toBe("legacy");
  });

  it("13.1: folder/dashboard/annotation resolve to apis; alerting resources remain legacy", () => {
    const table = buildRouteTable(flagsFromFixture(BUILD_INFO_OSS_13_1));
    expect(table.folder?.family).toBe("apis");
    expect(table.dashboard?.family).toBe("apis");
    expect(table.annotation?.family).toBe("apis");
    expect(table["contact-point"]?.family).toBe("legacy");
    expect(table["mute-timing"]?.family).toBe("legacy");
    expect(table["notification-template"]?.family).toBe("legacy");
  });

  it("current Cloud: same broad apis coverage as 13.1", () => {
    const table = buildRouteTable(flagsFromFixture(BUILD_INFO_CLOUD_CURRENT));
    expect(table.folder?.family).toBe("apis");
    expect(table.annotation?.family).toBe("apis");
    expect(table["alert-rule"]?.family).toBe("legacy");
  });

  it("every pinned fixture resolves every one of the 7 kinds to SOME family (nothing unsupported)", () => {
    for (const fixture of PINNED_BUILD_INFO_FIXTURES) {
      const table = buildRouteTable(flagsFromFixture(fixture));
      for (const kind of GRAFANA_RESOURCE_KINDS) {
        expect(table[kind]).toBeDefined();
      }
    }
  });
});

describe("encode/decode round-trips through CapabilitySnapshot.apiFamilies's flat string shape", () => {
  it("decodeApiFamiliesToRouteTable(encodeRouteTableToApiFamilies(table)) is the identity", () => {
    for (const fixture of PINNED_BUILD_INFO_FIXTURES) {
      const table = buildRouteTable(flagsFromFixture(fixture));
      const decoded = decodeApiFamiliesToRouteTable(encodeRouteTableToApiFamilies(table));
      expect(decoded).toEqual(table);
    }
  });

  it("ignores malformed/unknown tokens rather than throwing", () => {
    const decoded = decodeApiFamiliesToRouteTable([
      "not-a-token",
      "folder:not-a-family",
      "unknown-kind:legacy",
      "folder:legacy",
    ]);
    expect(decoded.folder?.family).toBe("legacy");
    expect(Object.keys(decoded)).toEqual(["folder"]);
  });
});

const kindArb = fc.constantFrom(...GRAFANA_RESOURCE_KINDS);
const familyArb = fc.constantFrom("legacy" as const, "apis" as const);

describe("route-table selection is a deterministic function of capability alone (property)", () => {
  it("never takes a version string as input at the type level — selectRouteFamily's signature is (kind, flags) only", () => {
    // Type-level proof: this call compiles with exactly 2 arguments; a 3rd
    // "version" argument would be a type error, caught by `tsc -b`.
    const kind: GrafanaResourceKind = "folder";
    const flags: CapabilityFlagSet = new Set([capabilityFlag(kind, "legacy")]);
    expect(selectRouteFamily(kind, flags)).toBe("legacy");
  });

  it("shuffling insertion order and duplicating entries never changes the selected family", () => {
    fc.assert(
      fc.property(
        kindArb,
        fc.uniqueArray(fc.tuple(kindArb, familyArb), { maxLength: 14 }),
        (targetKind, entries) => {
          const baseline = new Set(entries.map(([k, f]) => capabilityFlag(k, f)));
          const baselineResult = selectRouteFamily(targetKind, baseline);

          // Rebuild the same set via a shuffled, duplicated insertion order.
          const shuffled = [...entries, ...entries].sort(() => 0.5 - Math.random());
          const rebuilt = new Set(shuffled.map(([k, f]) => capabilityFlag(k, f)));

          expect(selectRouteFamily(targetKind, rebuilt)).toBe(baselineResult);
          expect(rebuilt).toEqual(baseline);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("apis is always preferred over legacy when both are present, for every kind", () => {
    fc.assert(
      fc.property(kindArb, (kind) => {
        const flags = new Set([capabilityFlag(kind, "legacy"), capabilityFlag(kind, "apis")]);
        expect(selectRouteFamily(kind, flags)).toBe("apis");
      }),
      { numRuns: 50 },
    );
  });

  it("an empty capability set resolves every kind to undefined (unsupported)", () => {
    const table = buildRouteTable(new Set());
    for (const kind of GRAFANA_RESOURCE_KINDS) {
      expect(table[kind]).toBeUndefined();
    }
  });
});
