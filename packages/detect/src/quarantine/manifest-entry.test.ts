import { describe, expect, it } from "vitest";
import { CapabilityManifestEntrySchema } from "@eo/contracts";
import type { PinnedCandidate } from "./types.js";
import { buildManifestEntry } from "./manifest-entry.js";

describe("buildManifestEntry", () => {
  it("builds a schema-valid, pending skill entry", () => {
    const pinned: PinnedCandidate = {
      kind: "skill",
      name: "example-skill",
      files: [{ path: "SKILL.md", content: "# x\n" }],
      permissionFootprint: [],
      digest: "sha256:abc",
    };
    const entry = buildManifestEntry(pinned);
    expect(CapabilityManifestEntrySchema.safeParse(entry).success).toBe(true);
    expect(entry).toMatchObject({
      kind: "skill",
      name: "example-skill",
      digest: "sha256:abc",
      decision: "pending",
    });
  });

  it("carries sourceRef forward when provenance declares one", () => {
    const pinned: PinnedCandidate = {
      kind: "plugin",
      name: "example-plugin",
      files: [{ path: "plugin.json", content: "{}" }],
      permissionFootprint: [],
      digest: "sha256:def",
      provenance: { sourceRef: "abc123" },
    };
    const entry = buildManifestEntry(pinned);
    expect(entry).toMatchObject({ sourceRef: "abc123" });
  });

  it("builds a schema-valid entry for every one of the 5 digest-pinned kinds", () => {
    for (const kind of ["skill", "plugin", "hook", "mcp_server", "external_tool"] as const) {
      const pinned: PinnedCandidate = {
        kind,
        name: `example-${kind}`,
        files: [{ path: "x.json", content: "{}" }],
        permissionFootprint: [],
        digest: "sha256:xyz",
      };
      expect(CapabilityManifestEntrySchema.safeParse(buildManifestEntry(pinned)).success).toBe(
        true,
      );
    }
  });
});
