import { describe, expect, it } from "vitest";
import { WorkerAuthoredResultSchema } from "@crabgic/contracts";
import { WORKER_RESULT_SCHEMA } from "./run-dispatcher.js";

/**
 * THE TEST THAT WOULD HAVE CAUGHT IT, measured on run 97fb3b10 (2026-08-16).
 *
 * The daemon PUBLISHED a hand-written JSON Schema to the engine as
 * `outputFormat`, and the scheduler ENFORCED a zod schema against what came
 * back. Two schemas that had to agree, and nothing compared them. The published
 * one asked for `{outcome, summary}` with only `outcome` required; the enforced
 * one required seven fields. So every worker obeyed the contract it was given
 * and every result was rejected as malformed — a worker could not succeed, ever.
 *
 * Nothing here asserts the CONTENT of either schema. The property is only that
 * one is derived from the other, which is the thing that cannot rot.
 */
describe("the JSON Schema published to workers", () => {
  it("requires exactly the keys the enforced schema requires", () => {
    const enforced = Object.keys(WorkerAuthoredResultSchema.shape).sort();
    const published = [...((WORKER_RESULT_SCHEMA.required as string[]) ?? [])].sort();
    expect(published).toEqual(enforced);
  });

  it("describes exactly the properties the enforced schema accepts — no more", () => {
    // `.strict()` on the enforced side means an extra published property would
    // instruct workers to emit something guaranteed to be rejected.
    const enforced = Object.keys(WorkerAuthoredResultSchema.shape).sort();
    const properties = Object.keys(
      (WORKER_RESULT_SCHEMA.properties ?? {}) as Record<string, unknown>,
    ).sort();
    expect(properties).toEqual(enforced);
  });

  /**
   * The end-to-end property, and the one that actually failed in production: a
   * document a compliant worker would emit must survive the validator.
   */
  it("accepts a minimal document built to the published contract", () => {
    const asPublished = { outcome: "succeeded", summary: "did the thing", diagnostics: [] };
    expect(() => WorkerAuthoredResultSchema.parse(asPublished)).not.toThrow();
  });

  it("REFUSES the harness's own fields — a worker may not assert its workUnitId", () => {
    // Identity is the harness's to state. A worker naming its own `workUnitId`
    // is claiming an identity nothing verifies.
    expect(() =>
      WorkerAuthoredResultSchema.parse({
        outcome: "succeeded",
        summary: "s",
        diagnostics: [],
        workUnitId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toThrow();
  });
});

describe("what the engine will actually accept", () => {
  /**
   * MEASURED on run 1387f6d1 (2026-08-16). The engine validates the document
   * handed to `--json-schema` and refuses one whose `$schema` it cannot
   * resolve: "no schema with key or ref
   * https://json-schema.org/draft/2020-12/schema". The run died 1.3 seconds in,
   * before a worker existed — a schema that is correct and unusable.
   */
  it("carries no `$schema` annotation the engine cannot resolve", () => {
    expect(WORKER_RESULT_SCHEMA).not.toHaveProperty("$schema");
  });

  it("still describes the constraints — stripping the annotation is not a weakening", () => {
    // The negative control: an empty object would also satisfy the assertion
    // above, so pin that the document still says something.
    expect(WORKER_RESULT_SCHEMA.type).toBe("object");
    expect(Object.keys(WORKER_RESULT_SCHEMA.properties as object)).toContain("outcome");
  });
});
