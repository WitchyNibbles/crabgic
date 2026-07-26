import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkFamilyWiringAtProductionEntrypoint,
  checkGatewayDependencyEdge,
  checkToolsCallSupported,
  interpretToolsCallResponse,
} from "./gatewayFamilyCompleteness.js";

/**
 * These assertions inverted on 2026-07-25. Every one of them used to be a
 * deliberate CURRENT-STATE proof that the families were UNREACHABLE from
 * the shipped binary; the phase-23 composition-root work closed that gap,
 * so they now prove the opposite. The fixture-source unit tests that used
 * to live here went away with the mechanism they tested: family wiring is
 * no longer inferred by grepping `cli-entry.ts` for builder identifiers
 * (which never proved reachability anyway — an identifier can sit in a
 * comment or on a dead branch), it is read off the real registry.
 */
describe("checkFamilyWiringAtProductionEntrypoint — genuine integration (real production registry)", () => {
  it("reports all 8 families wired, with no missing tool names", () => {
    const results = checkFamilyWiringAtProductionEntrypoint();

    expect(results).toHaveLength(8);
    const unwired = results.filter((r) => !r.wiredAtProductionEntrypoint);
    expect(unwired.map((r) => ({ family: r.family, missing: r.missingToolNames }))).toEqual([]);
  });

  it("accounts for all 22 tool names across the 8 families (Gap 1's settled count)", () => {
    const results = checkFamilyWiringAtProductionEntrypoint();
    const allNames = results.flatMap((r) => r.toolNames);

    expect(allNames).toHaveLength(22);
    expect(new Set(allNames).size).toBe(22);
  });

  /**
   * `missingToolNames` is what makes a future regression legible: if a
   * family stops registering a leaf, the report names the leaf rather than
   * just flipping a boolean.
   */
  it("reports missingToolNames per family, so a future regression names what disappeared", () => {
    const results = checkFamilyWiringAtProductionEntrypoint();

    for (const result of results) {
      expect(result.missingToolNames).toEqual([]);
      expect(result.toolNames.length).toBeGreaterThan(0);
      expect(result.ownerPhase.length).toBeGreaterThan(0);
    }
  });
});

describe("checkGatewayDependencyEdge", () => {
  it("reports no dependency edge for a fixture manifest with no @crabgic/gateway entry", async () => {
    const scratchDir = await mkdtemp(join(tmpdir(), "eo-dep-edge-fixture-"));
    try {
      const manifestPath = join(scratchDir, "package.json");
      await writeFile(
        manifestPath,
        JSON.stringify({ dependencies: { "@crabgic/contracts": "0.0.0" } }),
        "utf8",
      );
      expect(checkGatewayDependencyEdge(manifestPath)).toEqual({ hasGatewayDependency: false });
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });

  it("reports a dependency edge when @crabgic/gateway is declared", async () => {
    const scratchDir = await mkdtemp(join(tmpdir(), "eo-dep-edge-fixture-"));
    try {
      const manifestPath = join(scratchDir, "package.json");
      await writeFile(
        manifestPath,
        JSON.stringify({ dependencies: { "@crabgic/gateway": "0.0.0" } }),
        "utf8",
      );
      expect(checkGatewayDependencyEdge(manifestPath)).toEqual({ hasGatewayDependency: true });
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });

  it("genuine integration: packages/cli/package.json now declares the @crabgic/gateway edge the native families need", () => {
    expect(checkGatewayDependencyEdge()).toEqual({ hasGatewayDependency: true });
  });
});

describe("checkToolsCallSupported — genuine integration (real MCP stdio server, PassThrough streams, no hang risk)", () => {
  it("proves a registered tool can actually be INVOKED over the wire", async () => {
    const result = await checkToolsCallSupported();

    expect(result.supported).toBe(true);
    expect(result.evidence).toContain("real result");
  });
});

describe("interpretToolsCallResponse — unit (both outcomes)", () => {
  it("reports unsupported for a JSON-RPC error response", () => {
    const result = interpretToolsCallResponse({
      error: { code: -32601, message: "unknown method" },
    });
    expect(result.supported).toBe(false);
    expect(result.evidence).toContain("unknown method");
  });

  it("reports supported for a real result response", () => {
    const result = interpretToolsCallResponse({
      result: { content: [{ type: "text", text: "ok" }] },
    });
    expect(result.supported).toBe(true);
    expect(result.evidence).toContain("real result");
  });
});
