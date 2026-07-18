import { describe, expect, it } from "vitest";
import {
  ENGINE_CAPABILITIES_FIELD_DESCRIPTIONS,
  ENGINE_CAPABILITIES_FIELD_NAMES,
} from "./engine-capabilities.js";
import { StubEngineAdapter } from "./stub-engine-adapter.js";

/**
 * `EngineCapabilities` field-exhaustiveness tests (interface-ledger Gap 7;
 * roadmap/03-envelope-compiler-engine-adapter.md work item 1: "a unit test
 * asserting `capabilities()`'s keys are exactly `supportsJsonSchema,
 * supportsSessionResume, permissionModel, sandboxModel, engineVersion`").
 * The type-level exhaustiveness proof itself (`ENGINE_CAPABILITIES_FIELD_
 * DESCRIPTIONS`'s `Record<keyof EngineCapabilities, string>` typing) is
 * checked by `npx tsc -b packages/engine-core`, not vitest (vitest
 * transpiles with esbuild and does not enforce excess/missing-property
 * checking on its own) — this file's own runtime assertions below are the
 * genuine, assertion-level RED/GREEN signal.
 */
describe("EngineCapabilities — field-exhaustiveness (interface-ledger Gap 7)", () => {
  it("ENGINE_CAPABILITIES_FIELD_NAMES is exactly the five Gap-7 fields, sorted", () => {
    expect(ENGINE_CAPABILITIES_FIELD_NAMES).toEqual([
      "engineVersion",
      "permissionModel",
      "sandboxModel",
      "supportsJsonSchema",
      "supportsSessionResume",
    ]);
  });

  it("the descriptor has exactly five entries, one description each", () => {
    expect(Object.keys(ENGINE_CAPABILITIES_FIELD_DESCRIPTIONS).sort()).toEqual(
      ENGINE_CAPABILITIES_FIELD_NAMES,
    );
    for (const field of ENGINE_CAPABILITIES_FIELD_NAMES) {
      const description =
        ENGINE_CAPABILITIES_FIELD_DESCRIPTIONS[
          field as keyof typeof ENGINE_CAPABILITIES_FIELD_DESCRIPTIONS
        ];
      expect(typeof description).toBe("string");
      expect(description.length).toBeGreaterThan(0);
    }
  });
});

describe("EngineAdapter.capabilities() — runtime keys test (roadmap/03 work item 1 failing-first fixture)", () => {
  it("returns keys that are exactly supportsJsonSchema, supportsSessionResume, permissionModel, sandboxModel, engineVersion — no more, no fewer", () => {
    const adapter = new StubEngineAdapter();
    const caps = adapter.capabilities();
    expect(Object.keys(caps).sort()).toEqual(ENGINE_CAPABILITIES_FIELD_NAMES);
  });

  it("supportsJsonSchema/supportsSessionResume are booleans; permissionModel/sandboxModel/engineVersion are strings", () => {
    const adapter = new StubEngineAdapter();
    const caps = adapter.capabilities();
    expect(typeof caps.supportsJsonSchema).toBe("boolean");
    expect(typeof caps.supportsSessionResume).toBe("boolean");
    expect(typeof caps.permissionModel).toBe("string");
    expect(typeof caps.sandboxModel).toBe("string");
    expect(typeof caps.engineVersion).toBe("string");
  });

  it("never carries the retired structuredOutput/sessionResume draft field names (Gap 7)", () => {
    const adapter = new StubEngineAdapter();
    const caps: Record<string, unknown> = { ...adapter.capabilities() };
    expect("structuredOutput" in caps).toBe(false);
    expect("sessionResume" in caps).toBe(false);
  });
});
