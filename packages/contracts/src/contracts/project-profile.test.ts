import { describe, expect, it } from "vitest";
import { ProjectProfileSchema } from "./project-profile.js";

const validEcosystem = {
  ecosystem: "node",
  packagePath: ".",
  buildCommand: "npm run build",
  testCommands: {
    unit: "npm run test:unit",
    integration: "npm run test:integration",
    e2e: "npm run test:e2e",
  },
  benchmarkCommand: "npm run bench",
};

const validProfile = {
  schemaVersion: 1,
  id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
  createdAt: "2026-07-15T12:00:00.000Z",
  ecosystems: [validEcosystem],
};

describe("ProjectProfileSchema — valid fixture", () => {
  it("parses a fully-valid fixture (roadmap/02 §Interfaces produced, ProjectProfile row)", () => {
    const result = ProjectProfileSchema.safeParse(validProfile);
    expect(result.success).toBe(true);
  });

  it("accepts a minimal ecosystem entry with only the required testCommands.unit field", () => {
    const minimal = {
      ...validProfile,
      ecosystems: [
        {
          ecosystem: "python",
          packagePath: ".",
          testCommands: { unit: "pytest" },
        },
      ],
    };
    expect(ProjectProfileSchema.safeParse(minimal).success).toBe(true);
  });

  it("accepts multiple ecosystems (monorepo, per 12's node/ts+python+go+rust fixture matrix)", () => {
    const monorepo = {
      ...validProfile,
      ecosystems: [
        validEcosystem,
        {
          ecosystem: "go",
          packagePath: "services/api",
          testCommands: { unit: "go test ./..." },
        },
      ],
    };
    expect(ProjectProfileSchema.safeParse(monorepo).success).toBe(true);
  });
});

describe("ProjectProfileSchema — invalid-shape rejection", () => {
  it("rejects a missing schemaVersion", () => {
    const { schemaVersion: _schemaVersion, ...rest } = validProfile;
    expect(ProjectProfileSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an empty ecosystems array (min(1))", () => {
    const invalid = { ...validProfile, ecosystems: [] };
    expect(ProjectProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an ecosystem missing the required testCommands.unit field", () => {
    const invalid = {
      ...validProfile,
      ecosystems: [{ ecosystem: "node", packagePath: ".", testCommands: {} }],
    };
    expect(ProjectProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a non-uuid id", () => {
    const invalid = { ...validProfile, id: "not-a-uuid" };
    expect(ProjectProfileSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("ProjectProfileSchema — unknown-key rejection (.strict())", () => {
  it("rejects an unknown top-level key", () => {
    const invalid = { ...validProfile, unexpected: "field" };
    expect(ProjectProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an unknown key on a nested ecosystem entry", () => {
    const invalid = {
      ...validProfile,
      ecosystems: [{ ...validEcosystem, unexpected: "field" }],
    };
    expect(ProjectProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an unknown key on nested testCommands", () => {
    const invalid = {
      ...validProfile,
      ecosystems: [
        {
          ...validEcosystem,
          testCommands: { ...validEcosystem.testCommands, lint: "npm run lint" },
        },
      ],
    };
    expect(ProjectProfileSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("ProjectProfileSchema — round-trip", () => {
  it("parse -> JSON.stringify -> JSON.parse -> parse yields a deep-equal output", () => {
    const first = ProjectProfileSchema.parse(validProfile);
    const roundTripped = ProjectProfileSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped).toStrictEqual(first);
  });
});
