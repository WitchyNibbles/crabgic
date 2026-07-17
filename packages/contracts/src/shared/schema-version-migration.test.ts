import { describe, expect, it } from "vitest";
import {
  DemoWidgetV1Schema,
  DemoWidgetV2Schema,
  migrateDemoWidgetV1ToV2,
} from "./schema-version-migration.demo.js";

describe("schemaVersion + migration pattern (demo, Risks bullet: work item 1)", () => {
  it("parses a valid v1 payload against the v1 schema", () => {
    const result = DemoWidgetV1Schema.safeParse({ schemaVersion: 1, name: "widget" });
    expect(result.success).toBe(true);
  });

  it("rejects a v1 payload against the v2 schema (literal schemaVersion mismatch)", () => {
    const result = DemoWidgetV2Schema.safeParse({ schemaVersion: 1, name: "widget" });
    expect(result.success).toBe(false);
  });

  it("rejects malformed v1 input before any migration would run", () => {
    const result = DemoWidgetV1Schema.safeParse({ schemaVersion: 1, name: "" });
    expect(result.success).toBe(false);
  });

  it("migrates a valid v1 payload to a v2 payload that validates against the v2 schema", () => {
    const v1: { schemaVersion: 1; name: string } = { schemaVersion: 1, name: "widget" };
    Object.freeze(v1);

    const v2 = migrateDemoWidgetV1ToV2(v1);

    const result = DemoWidgetV2Schema.safeParse(v2);
    expect(result.success).toBe(true);
    expect(v2.name).toBe("widget");
    expect(v2.description).toBe("");
  });

  it("does not mutate its input (immutability discipline)", () => {
    const v1: { schemaVersion: 1; name: string } = { schemaVersion: 1, name: "widget" };
    const frozen = Object.freeze({ ...v1 });

    expect(() => migrateDemoWidgetV1ToV2(frozen)).not.toThrow();
    expect(frozen).toEqual({ schemaVersion: 1, name: "widget" });
  });
});
