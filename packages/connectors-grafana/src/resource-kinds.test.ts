import { describe, expect, it } from "vitest";
import { HighImpactCapabilityFlagSchema } from "@eo/contracts";
import {
  GRAFANA_HIGH_IMPACT_FLAGS,
  GRAFANA_RESOURCE_KINDS,
  HIGH_IMPACT_FLAG_BY_KIND,
  isGrafanaResourceKind,
} from "./resource-kinds.js";

describe("GRAFANA_RESOURCE_KINDS", () => {
  it("is exactly the 7 kinds roadmap/20 §In scope names, no more, no fewer", () => {
    expect([...GRAFANA_RESOURCE_KINDS].sort()).toEqual(
      [
        "folder",
        "dashboard",
        "annotation",
        "alert-rule",
        "contact-point",
        "mute-timing",
        "notification-template",
      ].sort(),
    );
  });

  it("isGrafanaResourceKind narrows correctly and rejects unknown strings", () => {
    for (const kind of GRAFANA_RESOURCE_KINDS) {
      expect(isGrafanaResourceKind(kind)).toBe(true);
    }
    expect(isGrafanaResourceKind("data-source")).toBe(false);
    expect(isGrafanaResourceKind("user")).toBe(false);
    expect(isGrafanaResourceKind(42)).toBe(false);
  });
});

describe("HIGH_IMPACT_FLAG_BY_KIND", () => {
  it("maps exactly the 4 high-impact kinds to a valid HighImpactCapabilityFlag member, verbatim", () => {
    expect(HIGH_IMPACT_FLAG_BY_KIND["alert-rule"]).toBe("alert disabling");
    expect(HIGH_IMPACT_FLAG_BY_KIND["contact-point"]).toBe("contact points");
    expect(HIGH_IMPACT_FLAG_BY_KIND["mute-timing"]).toBe("mute timings");
    expect(HIGH_IMPACT_FLAG_BY_KIND["notification-template"]).toBe("notification templates");
    for (const flag of Object.values(HIGH_IMPACT_FLAG_BY_KIND)) {
      expect(() => HighImpactCapabilityFlagSchema.parse(flag)).not.toThrow();
    }
  });

  it("carries no flag for folder/dashboard/annotation", () => {
    expect(HIGH_IMPACT_FLAG_BY_KIND.folder).toBeUndefined();
    expect(HIGH_IMPACT_FLAG_BY_KIND.dashboard).toBeUndefined();
    expect(HIGH_IMPACT_FLAG_BY_KIND.annotation).toBeUndefined();
  });

  it("GRAFANA_HIGH_IMPACT_FLAGS is exactly the table's 4 values", () => {
    expect([...GRAFANA_HIGH_IMPACT_FLAGS].sort()).toEqual(
      Object.values(HIGH_IMPACT_FLAG_BY_KIND).sort(),
    );
  });
});
