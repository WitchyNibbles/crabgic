import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkFamilyWiringAtProductionEntrypoint,
  checkGatewayDependencyEdge,
  checkToolsCallSupported,
  interpretToolsCallResponse,
} from "./gatewayFamilyCompleteness.js";

describe("checkFamilyWiringAtProductionEntrypoint — unit (fixture source files)", () => {
  let scratchDir: string;

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "eo-family-wiring-fixture-"));
  });

  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  it("reports every family unwired when the fixture source references none of the builder identifiers (mirrors the empty-registry gap)", async () => {
    const fixturePath = join(scratchDir, "cli-entry.ts");
    await writeFile(fixturePath, "export function defaultRunGatewayMcp() {}\n", "utf8");

    const results = checkFamilyWiringAtProductionEntrypoint(fixturePath);
    expect(results).toHaveLength(8);
    expect(results.every((r) => !r.wiredAtProductionEntrypoint)).toBe(true);
  });

  it("reports a family wired once the fixture source references its builder identifier", async () => {
    const fixturePath = join(scratchDir, "cli-entry.ts");
    await writeFile(
      fixturePath,
      "import { buildTrackerTools } from '@eo/gateway';\nbuildTrackerTools({});\n",
      "utf8",
    );

    const results = checkFamilyWiringAtProductionEntrypoint(fixturePath);
    const tracker = results.find((r) => r.family === "tracker");
    expect(tracker?.wiredAtProductionEntrypoint).toBe(true);
    expect(
      results.filter((r) => r.family !== "tracker").every((r) => !r.wiredAtProductionEntrypoint),
    ).toBe(true);
  });

  it("reports every family wired when the fixture references every builder identifier", async () => {
    const fixturePath = join(scratchDir, "cli-entry.ts");
    const identifiers = [
      "buildTrackerTools",
      "buildObservabilityTools",
      "buildEvidenceTools",
      "buildResultTools",
      "buildRunForwardTools",
      "registerIntakeTools",
      "registerIntakeTools",
      "registerCapabilityTools",
    ];
    await writeFile(fixturePath, identifiers.map((id) => `${id}();`).join("\n"), "utf8");

    const results = checkFamilyWiringAtProductionEntrypoint(fixturePath);
    expect(results.every((r) => r.wiredAtProductionEntrypoint)).toBe(true);
  });
});

describe("checkFamilyWiringAtProductionEntrypoint — genuine integration (real cli-entry.ts)", () => {
  it("reflects today's real gap: zero of the 8 families are wired at the actual production gateway-mcp entrypoint", () => {
    const results = checkFamilyWiringAtProductionEntrypoint();
    expect(results).toHaveLength(8);
    const unwired = results.filter((r) => !r.wiredAtProductionEntrypoint);
    // This assertion is a deliberate, documented CURRENT-STATE proof (see
    // this module's own file-level doc comment) — it is expected to keep
    // passing (i.e. the gap keeps being accurately reported) until a real
    // wiring change lands in packages/cli, which is explicitly out of
    // scope for this harness to perform.
    expect(unwired.map((r) => r.family).sort()).toEqual(
      [
        "capability-audit-approve",
        "contract-approve",
        "evidence",
        "observability",
        "project-inspect",
        "result",
        "run-forward",
        "tracker",
      ].sort(),
    );
  });
});

describe("checkGatewayDependencyEdge", () => {
  it("reports no dependency edge for a fixture manifest with no @eo/gateway entry", async () => {
    const scratchDir = await mkdtemp(join(tmpdir(), "eo-dep-edge-fixture-"));
    try {
      const manifestPath = join(scratchDir, "package.json");
      await writeFile(
        manifestPath,
        JSON.stringify({ dependencies: { "@eo/contracts": "0.0.0" } }),
        "utf8",
      );
      expect(checkGatewayDependencyEdge(manifestPath)).toEqual({ hasGatewayDependency: false });
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });

  it("reports a dependency edge when @eo/gateway is declared", async () => {
    const scratchDir = await mkdtemp(join(tmpdir(), "eo-dep-edge-fixture-"));
    try {
      const manifestPath = join(scratchDir, "package.json");
      await writeFile(
        manifestPath,
        JSON.stringify({ dependencies: { "@eo/gateway": "0.0.0" } }),
        "utf8",
      );
      expect(checkGatewayDependencyEdge(manifestPath)).toEqual({ hasGatewayDependency: true });
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });

  it("genuine integration: packages/cli/package.json today has no @eo/gateway dependency edge (corroborates the family-wiring gap)", () => {
    expect(checkGatewayDependencyEdge()).toEqual({ hasGatewayDependency: false });
  });
});

describe("checkToolsCallSupported — genuine integration (real stdio-server.ts, PassThrough streams, no hang risk)", () => {
  it("proves tools/call is entirely unimplemented — a real registered tool cannot actually be invoked over this wire", async () => {
    const result = await checkToolsCallSupported();
    expect(result.supported).toBe(false);
    expect(result.evidence).toContain("tools/call");
  });
});

describe("interpretToolsCallResponse — unit (both outcomes, including the not-yet-reachable success shape)", () => {
  it("reports unsupported for a JSON-RPC error response (today's real shape)", () => {
    const result = interpretToolsCallResponse({
      error: { code: -32601, message: "unknown method" },
    });
    expect(result.supported).toBe(false);
    expect(result.evidence).toContain("unknown method");
  });

  it("reports supported for a real result response (the shape this would need to look like if the gap were ever fixed)", () => {
    const result = interpretToolsCallResponse({
      result: { content: [{ type: "text", text: "ok" }] },
    });
    expect(result.supported).toBe(true);
    expect(result.evidence).toContain("real result");
  });
});
