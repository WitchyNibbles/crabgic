import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { getResourceDefinition } from "../resources/definitions/index.js";
import { supportsApisFamily } from "../resources/resource-definitions.js";
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

  // ANNOTATION IS `legacy` HERE EVEN THOUGH 13.1 ADVERTISES `apis` FOR IT.
  // The build offers the family; this connector cannot yet speak it — no
  // App Platform behaviour has been verified for annotations against a real
  // server (`annotation.grafana.app` is not even served by 12.4, the newest
  // recipe this repo can boot). Routing it to `apis` regardless is precisely
  // the defect that broke every 12.4+ write, so it falls back to the family
  // that works. This expectation flips to "apis" when, and only when,
  // `annotationDefinition` gains a verified `apis` behaviour.
  it("13.1: folder/dashboard resolve to apis; annotation and alerting stay legacy", () => {
    const table = buildRouteTable(flagsFromFixture(BUILD_INFO_OSS_13_1));
    expect(table.folder?.family).toBe("apis");
    expect(table.dashboard?.family).toBe("apis");
    expect(table.annotation?.family).toBe("legacy");
    expect(table["contact-point"]?.family).toBe("legacy");
    expect(table["mute-timing"]?.family).toBe("legacy");
    expect(table["notification-template"]?.family).toBe("legacy");
  });

  it("current Cloud: same coverage as 13.1 — folder/dashboard on apis, the rest legacy", () => {
    const table = buildRouteTable(flagsFromFixture(BUILD_INFO_CLOUD_CURRENT));
    expect(table.folder?.family).toBe("apis");
    expect(table.dashboard?.family).toBe("apis");
    expect(table.annotation?.family).toBe("legacy");
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

  /**
   * CORRECTED CONTRACT (2026-07-26). This previously asserted that `apis`
   * wins over `legacy` for EVERY kind whenever both are advertised, and that
   * is exactly the rule that broke every write against a real Grafana 12.4+:
   * no resource definition could build an App Platform request, so the
   * classic path fragment and body were sent to the Kubernetes-style base
   * path and the server answered with a `Status` object. Advertisement is
   * necessary but not sufficient — the connector must also be able to speak
   * the family. `supportsApisFamily` is the second condition.
   */
  it("prefers apis over legacy for every kind this connector can speak it for", () => {
    fc.assert(
      fc.property(kindArb, (kind) => {
        const flags = new Set([capabilityFlag(kind, "legacy"), capabilityFlag(kind, "apis")]);
        const expected = supportsApisFamily(getResourceDefinition(kind)) ? "apis" : "legacy";
        expect(selectRouteFamily(kind, flags)).toBe(expected);
      }),
      { numRuns: 50 },
    );
  });

  it("falls back to legacy — never to a family it cannot build requests for", () => {
    for (const kind of GRAFANA_RESOURCE_KINDS) {
      if (supportsApisFamily(getResourceDefinition(kind))) continue;
      const flags = new Set([capabilityFlag(kind, "legacy"), capabilityFlag(kind, "apis")]);
      expect(selectRouteFamily(kind, flags)).toBe("legacy");
    }
  });

  /**
   * The honest end of the same rule: a kind offered ONLY on a family we
   * cannot speak is unsupported on that build. Reporting it as absent makes
   * `resolveRouteForKind` raise "no route available", which is a stated
   * refusal — far better than routing a request somewhere it will fail.
   */
  it("reports a kind offered only on an unspeakable family as unsupported", () => {
    for (const kind of GRAFANA_RESOURCE_KINDS) {
      if (supportsApisFamily(getResourceDefinition(kind))) continue;
      expect(selectRouteFamily(kind, new Set([capabilityFlag(kind, "apis")]))).toBeUndefined();
    }
  });

  it("an empty capability set resolves every kind to undefined (unsupported)", () => {
    const table = buildRouteTable(new Set());
    for (const kind of GRAFANA_RESOURCE_KINDS) {
      expect(table[kind]).toBeUndefined();
    }
  });
});
