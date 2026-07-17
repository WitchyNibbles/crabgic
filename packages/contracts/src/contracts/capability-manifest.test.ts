import { describe, expect, it } from "vitest";
import { CapabilityManifestSchema } from "./capability-manifest.js";
import { GATEWAY_MCP_SERVER_NAME } from "../gateway/server-name.js";

const skillEntry = {
  kind: "skill",
  name: "node-testing",
  digest: "sha256:aaa",
  decision: "approved",
};
const pluginEntry = {
  kind: "plugin",
  name: "eo-plugin",
  digest: "sha256:bbb",
  sourceRef: "github.com/org/repo@abc123",
  decision: "pending",
};
const hookEntry = { kind: "hook", name: "audit-hook", digest: "sha256:ccc", decision: "approved" };
const mcpServerEntry = {
  kind: "mcp_server",
  name: GATEWAY_MCP_SERVER_NAME,
  digest: "sha256:ddd",
  decision: "approved",
};
const externalToolEntry = {
  kind: "external_tool",
  name: "semgrep",
  digest: "sha256:eee",
  decision: "approved",
};
const engineEntry = {
  kind: "engine",
  engineVersion: "2.1.207",
  supportsJsonSchema: true,
  supportsSessionResume: true,
};
const modelEntry = { kind: "model", role: "implementation", modelId: "claude-sonnet-5" };

const validManifest = {
  schemaVersion: 1,
  id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
  changeSetId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  createdAt: "2026-07-15T12:00:00.000Z",
  entries: [
    skillEntry,
    pluginEntry,
    hookEntry,
    mcpServerEntry,
    externalToolEntry,
    engineEntry,
    modelEntry,
  ],
};

describe("CapabilityManifestSchema — valid fixture", () => {
  it("parses a fully-valid fixture covering all 7 entry kinds (roadmap/11 + roadmap/06 Gap 7 + adaptation:60)", () => {
    expect(CapabilityManifestSchema.safeParse(validManifest).success).toBe(true);
  });

  it("accepts an empty entries array (graceful degradation before 12/10 populate, per 11's own posture)", () => {
    const empty = { ...validManifest, entries: [] };
    expect(CapabilityManifestSchema.safeParse(empty).success).toBe(true);
  });
});

describe("CapabilityManifestSchema — discriminated-union branch coverage", () => {
  it.each([
    ["skill", skillEntry],
    ["plugin", pluginEntry],
    ["hook", hookEntry],
    ["mcp_server", mcpServerEntry],
    ["external_tool", externalToolEntry],
    ["engine", engineEntry],
    ["model", modelEntry],
  ] as const)("accepts a lone %s entry", (_kind, entry) => {
    const fixture = { ...validManifest, entries: [entry] };
    expect(CapabilityManifestSchema.safeParse(fixture).success).toBe(true);
  });
});

describe("CapabilityManifestSchema — invalid-shape rejection", () => {
  it("rejects an engine entry missing supportsSessionResume (roadmap/06 Gap 7 field set)", () => {
    const { supportsSessionResume: _supportsSessionResume, ...brokenEngine } = engineEntry;
    const invalid = { ...validManifest, entries: [brokenEngine] };
    expect(CapabilityManifestSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a skill entry missing digest (12's 'digest-pinned' requirement)", () => {
    const { digest: _digest, ...brokenSkill } = skillEntry;
    const invalid = { ...validManifest, entries: [brokenSkill] };
    expect(CapabilityManifestSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a decision value outside pending|approved|rejected", () => {
    const invalid = { ...validManifest, entries: [{ ...skillEntry, decision: "maybe" }] };
    expect(CapabilityManifestSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an entry kind outside the closed 7-member union", () => {
    const invalid = { ...validManifest, entries: [{ kind: "database", name: "x" }] };
    expect(CapabilityManifestSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("CapabilityManifestSchema — unknown-key rejection (.strict())", () => {
  it("rejects an unknown top-level key", () => {
    const invalid = { ...validManifest, unexpected: "field" };
    expect(CapabilityManifestSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an unknown key on a digest-pinned entry", () => {
    const invalid = { ...validManifest, entries: [{ ...skillEntry, unexpected: "field" }] };
    expect(CapabilityManifestSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an unknown key on the engine entry", () => {
    const invalid = { ...validManifest, entries: [{ ...engineEntry, unexpected: "field" }] };
    expect(CapabilityManifestSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("CapabilityManifestSchema — round-trip", () => {
  it("parse -> JSON.stringify -> JSON.parse -> parse yields a deep-equal output", () => {
    const first = CapabilityManifestSchema.parse(validManifest);
    const roundTripped = CapabilityManifestSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped).toStrictEqual(first);
  });
});
