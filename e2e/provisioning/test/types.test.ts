import { describe, expect, it } from "vitest";

import { ProvisionConfigSchema } from "../src/types.js";

/**
 * roadmap/23-release-hardening.md work item 2: config validated at the
 * system boundary with zod, per this repo's own coding-style convention.
 */
describe("ProvisionConfigSchema", () => {
  it("accepts a minimal valid config and applies documented defaults", () => {
    const parsed = ProvisionConfigSchema.parse({
      runId: "run-1",
      composeFile: "docker-compose.yml",
    });
    expect(parsed.healthTimeoutMs).toBe(300_000);
    expect(parsed.healthPollIntervalMs).toBe(2_000);
    expect(parsed.services).toBeUndefined();
  });

  it("rejects an empty runId", () => {
    expect(() => ProvisionConfigSchema.parse({ runId: "", composeFile: "x.yml" })).toThrow();
  });

  it("rejects an empty composeFile", () => {
    expect(() => ProvisionConfigSchema.parse({ runId: "run-1", composeFile: "" })).toThrow();
  });

  it("rejects a non-positive healthTimeoutMs", () => {
    expect(() =>
      ProvisionConfigSchema.parse({ runId: "run-1", composeFile: "x.yml", healthTimeoutMs: 0 }),
    ).toThrow();
  });

  it("rejects a non-positive healthPollIntervalMs", () => {
    expect(() =>
      ProvisionConfigSchema.parse({
        runId: "run-1",
        composeFile: "x.yml",
        healthPollIntervalMs: -1,
      }),
    ).toThrow();
  });

  it("accepts an explicit services list", () => {
    const parsed = ProvisionConfigSchema.parse({
      runId: "run-1",
      composeFile: "x.yml",
      services: ["grafana"],
    });
    expect(parsed.services).toEqual(["grafana"]);
  });

  it("rejects an empty-string entry inside services", () => {
    expect(() =>
      ProvisionConfigSchema.parse({ runId: "run-1", composeFile: "x.yml", services: [""] }),
    ).toThrow();
  });
});
