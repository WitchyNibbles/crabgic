import { describe, expect, it } from "vitest";
import { CapabilityManifestSchema } from "@eo/contracts";
import { buildCapabilityManifest } from "./capability-manifest-builder.js";

const ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = "2026-01-01T00:00:00.000Z";

describe("buildCapabilityManifest", () => {
  it("degrades gracefully to an empty-entries manifest when every source is absent (pre-06/pre-10/pre-12 case)", () => {
    const manifest = buildCapabilityManifest({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
    });
    expect(CapabilityManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.entries).toEqual([]);
  });

  it("folds in the engine entry, plugin entry, quarantine entries, and model roster when all are supplied", () => {
    const manifest = buildCapabilityManifest({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      engineEntry: {
        kind: "engine",
        engineVersion: "2.1.0",
        supportsJsonSchema: true,
        supportsSessionResume: true,
      },
      pluginEntry: {
        kind: "plugin",
        name: "engineering-orchestrator",
        digest: "sha256:aaaa",
        decision: "pending",
      },
      quarantineEntries: [
        { kind: "skill", name: "eo-explore", digest: "sha256:bbbb", decision: "approved" },
        {
          kind: "mcp_server",
          name: "gateway-mcp-server",
          digest: "sha256:cccc",
          decision: "pending",
        },
      ],
      modelRoster: [{ kind: "model", role: "implementation", modelId: "claude-sonnet-5" }],
    });
    expect(manifest.entries).toHaveLength(5);
    expect(manifest.entries.map((e) => e.kind)).toEqual([
      "engine",
      "plugin",
      "skill",
      "mcp_server",
      "model",
    ]);
    expect(CapabilityManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it("MEDIUM M3: derives the engine entry from a REAL EngineAdapter.capabilities() call — not a hand-supplied fixture literal", () => {
    let capabilitiesCallCount = 0;
    const adapter = {
      capabilities: () => {
        capabilitiesCallCount++;
        return {
          engineVersion: "9.9.9-real-adapter",
          supportsJsonSchema: false,
          supportsSessionResume: true,
          permissionModel: "dontAsk",
          sandboxModel: "bubblewrap",
        };
      },
    };

    const manifest = buildCapabilityManifest({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      engineAdapter: adapter,
    });

    expect(capabilitiesCallCount).toBe(1);
    expect(manifest.entries).toEqual([
      {
        kind: "engine",
        engineVersion: "9.9.9-real-adapter",
        supportsJsonSchema: false,
        supportsSessionResume: true,
      },
    ]);
  });

  it("MEDIUM M3: engineAdapter takes priority over a separately-supplied engineEntry literal", () => {
    const adapter = {
      capabilities: () => ({
        engineVersion: "adapter-wins",
        supportsJsonSchema: true,
        supportsSessionResume: false,
        permissionModel: "dontAsk",
        sandboxModel: "bubblewrap",
      }),
    };
    const manifest = buildCapabilityManifest({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      engineAdapter: adapter,
      engineEntry: {
        kind: "engine",
        engineVersion: "literal-should-lose",
        supportsJsonSchema: false,
        supportsSessionResume: false,
      },
    });
    expect(manifest.entries).toEqual([
      {
        kind: "engine",
        engineVersion: "adapter-wins",
        supportsJsonSchema: true,
        supportsSessionResume: false,
      },
    ]);
  });

  it("is byte-stable across two identical builds", () => {
    const build = () =>
      buildCapabilityManifest({
        id: ID,
        changeSetId: CHANGE_SET_ID,
        createdAt: CREATED_AT,
        quarantineEntries: [
          { kind: "hook", name: "post-tool-use", digest: "sha256:dddd", decision: "approved" },
        ],
      });
    expect(build()).toEqual(build());
  });
});
