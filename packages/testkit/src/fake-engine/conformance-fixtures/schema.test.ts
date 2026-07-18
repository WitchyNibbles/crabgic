import { describe, expect, it } from "vitest";
import { ConformanceFixtureSchema, validateConformanceFixture } from "./schema.js";

/**
 * roadmap/03-envelope-compiler-engine-adapter.md work item 6's own
 * failing-first fixture: "a fixture-schema validator run against a
 * hand-written fixture missing a required per-layer verdict field — fails
 * until the format + validator exist." See
 * `docs/evidence/phase-03/wi6-conformance-failing.txt`.
 */
const VALID_FIXTURE = {
  name: "example-fixture",
  description: "an example fixture for schema-shape testing",
  baselineCitation: "docs/engine-baseline.md §3",
  toolCall: { toolName: "Bash", toolInput: { command: "echo hi" } },
  expected: { permissions: "allow", adjudication: "allow", sandbox: "allow" },
};

describe("ConformanceFixtureSchema — RED fixture: missing a required per-layer verdict field", () => {
  it("rejects a fixture whose 'expected' object is missing the 'sandbox' verdict", () => {
    const broken = {
      ...VALID_FIXTURE,
      expected: { permissions: "allow", adjudication: "allow" },
    };
    expect(() => validateConformanceFixture(broken)).toThrow();
  });

  it("rejects a fixture missing the entire 'expected' object", () => {
    const { expected: _expected, ...broken } = VALID_FIXTURE;
    expect(() => validateConformanceFixture(broken)).toThrow();
  });

  it("rejects an 'expected' verdict value outside the allow|deny enum", () => {
    const broken = {
      ...VALID_FIXTURE,
      expected: { permissions: "maybe", adjudication: "allow", sandbox: "allow" },
    };
    expect(() => validateConformanceFixture(broken)).toThrow();
  });

  it("rejects an unknown extra top-level field (.strict())", () => {
    const broken = { ...VALID_FIXTURE, unknownField: "nope" };
    expect(() => validateConformanceFixture(broken)).toThrow();
  });
});

describe("ConformanceFixtureSchema — accepts a well-formed fixture", () => {
  it("parses the valid fixture and round-trips its fields", () => {
    const parsed = validateConformanceFixture(VALID_FIXTURE);
    expect(parsed.name).toBe("example-fixture");
    expect(parsed.expected).toEqual({
      permissions: "allow",
      adjudication: "allow",
      sandbox: "allow",
    });
  });

  it("accepts optional permissionOverride/additionalPermissionLevels/envelopeOverrides fields", () => {
    const withOptional = {
      ...VALID_FIXTURE,
      envelopeOverrides: { ownedPaths: ["x"] },
      permissionOverride: { allow: ["Bash(echo:*)"], deny: [] },
      additionalPermissionLevels: [{ allow: [], deny: ["Bash(echo:*)"] }],
    };
    expect(() => validateConformanceFixture(withOptional)).not.toThrow();
  });
});

describe("ConformanceFixtureSchema is directly usable via its own zod .strict() parse", () => {
  it("ConformanceFixtureSchema.parse behaves identically to validateConformanceFixture", () => {
    expect(ConformanceFixtureSchema.parse(VALID_FIXTURE)).toEqual(
      validateConformanceFixture(VALID_FIXTURE),
    );
  });
});
