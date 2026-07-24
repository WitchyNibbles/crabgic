import { describe, expect, it } from "vitest";
import { HighImpactCapabilityFlagSchema } from "@eo/contracts";
import { GRAFANA_RESOURCE_KINDS, type GrafanaResourceKind } from "../resource-kinds.js";
import { requiredHighImpactFlagsFor } from "./high-impact-tagging.js";

const NON_HIGH_IMPACT_KINDS: readonly GrafanaResourceKind[] = ["folder", "dashboard", "annotation"];
const UNCONDITIONAL_HIGH_IMPACT_KINDS: readonly GrafanaResourceKind[] = [
  "contact-point",
  "mute-timing",
  "notification-template",
];

describe("requiredHighImpactFlagsFor — exit criterion: static tagging fails closed on any untagged high-impact call", () => {
  it("folder/dashboard/annotation never carry a high-impact flag, create or update", () => {
    for (const kind of NON_HIGH_IMPACT_KINDS) {
      expect(requiredHighImpactFlagsFor(kind, "create", { title: "x" })).toEqual([]);
      expect(requiredHighImpactFlagsFor(kind, "update", { title: "x" })).toEqual([]);
    }
  });

  it("contact-point/mute-timing/notification-template ALWAYS carry their flag, create and update, regardless of which fields the input touches", () => {
    for (const kind of UNCONDITIONAL_HIGH_IMPACT_KINDS) {
      for (const action of ["create", "update"] as const) {
        const flags = requiredHighImpactFlagsFor(kind, action, { name: "x" });
        expect(flags.length).toBe(1);
        expect(() => HighImpactCapabilityFlagSchema.parse(flags[0])).not.toThrow();
      }
    }
  });

  it("contact-point/mute-timing/notification-template are flagged even with no input object at all", () => {
    for (const kind of UNCONDITIONAL_HIGH_IMPACT_KINDS) {
      expect(requiredHighImpactFlagsFor(kind, "create").length).toBe(1);
    }
  });

  it('alert-rule CREATE is flagged "alert disabling" ONLY when the input touches isPaused', () => {
    expect(requiredHighImpactFlagsFor("alert-rule", "create", { title: "new rule" })).toEqual([]);
    expect(requiredHighImpactFlagsFor("alert-rule", "create", { isPaused: true })).toEqual([
      "alert disabling",
    ]);
    // A create's own condition/ruleGroup/for don't matter — nothing
    // pre-existing is being neutralized by a brand-new rule.
    expect(
      requiredHighImpactFlagsFor("alert-rule", "create", {
        condition: "B",
        ruleGroup: "g",
        for: "5m",
      }),
    ).toEqual([]);
  });

  it('alert-rule UPDATE is flagged "alert disabling" when the input touches isPaused', () => {
    expect(requiredHighImpactFlagsFor("alert-rule", "update", { isPaused: true })).toEqual([
      "alert disabling",
    ]);
    expect(requiredHighImpactFlagsFor("alert-rule", "update", { isPaused: false })).toEqual([
      "alert disabling",
    ]);
    expect(requiredHighImpactFlagsFor("alert-rule", "update", { title: "renamed" })).toEqual([]);
  });

  it('adversarial-review MEDIUM fix: alert-rule UPDATE is ALSO flagged "alert disabling" when condition/for/ruleGroup are touched — not just isPaused (an update can silently neutralize a firing alert without ever touching isPaused)', () => {
    expect(requiredHighImpactFlagsFor("alert-rule", "update", { condition: "1 == 2" })).toEqual([
      "alert disabling",
    ]);
    expect(
      requiredHighImpactFlagsFor("alert-rule", "update", { ruleGroup: "quiet-unwatched-group" }),
    ).toEqual(["alert disabling"]);
    expect(requiredHighImpactFlagsFor("alert-rule", "update", { for: "999h" })).toEqual([
      "alert disabling",
    ]);
    // A field combination touching NONE of the firing-behavior fields is
    // still unflagged (e.g. a pure rename).
    expect(
      requiredHighImpactFlagsFor("alert-rule", "update", { title: "renamed", folderUID: "f2" }),
    ).toEqual([]);
  });

  it("static exhaustive sweep: every (kind, action) combination that SHOULD be flagged actually is (fails the whole suite if any is silently dropped)", () => {
    const violations: string[] = [];
    for (const kind of GRAFANA_RESOURCE_KINDS) {
      for (const action of ["create", "update"] as const) {
        const shouldFlag = (UNCONDITIONAL_HIGH_IMPACT_KINDS as readonly string[]).includes(kind);
        const flags = requiredHighImpactFlagsFor(kind, action, { name: "x", title: "x" });
        if (shouldFlag && flags.length === 0) {
          violations.push(`${kind}:${action} should be flagged but was not`);
        }
        if (!shouldFlag && kind !== "alert-rule" && flags.length > 0) {
          violations.push(`${kind}:${action} was flagged but should not be`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
