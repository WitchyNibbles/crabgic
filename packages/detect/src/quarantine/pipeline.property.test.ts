import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { runQuarantinePipeline } from "./pipeline.js";
import { PIPELINE_STAGES } from "./types.js";

/**
 * roadmap/12 §Test plan, "Property" bullet: "quarantine stage ordering is
 * total — no fixture reaches a manifest entry having skipped an earlier
 * stage." Randomizes WHICH stage (if any) is forced to fail and asserts
 * the resulting `report.stages` is always the EXACT prefix of
 * `PIPELINE_STAGES` up through the first failing stage — never a skip,
 * never a stage recorded past a failure — and a `manifestEntry` exists
 * if and only if every one of the 6 stages passed.
 */
describe("runQuarantinePipeline — stage-ordering totality (property)", () => {
  it("report.stages is always an exact ordered prefix of PIPELINE_STAGES, and manifestEntry exists iff all 6 stages passed", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"none" | "fetch" | "provenance" | "scan" | "sandbox">(
          "none",
          "fetch",
          "provenance",
          "scan",
          "sandbox",
        ),
        (failAt) => {
          const source = {
            kind: "skill" as const,
            name: "fixture-skill",
            files: [
              {
                path: "SKILL.md",
                content: failAt === "scan" ? "AKIAABCDEFGHIJKLMNOP" : "# ordinary skill body\n",
              },
            ],
            permissionFootprint: [],
            ...(failAt === "fetch" ? { token: "leaked-secret" } : {}),
            ...(failAt === "sandbox"
              ? { selfTestPlan: [{ type: "network" as const, target: "evil.example.com" }] }
              : {}),
          };
          const options =
            failAt === "provenance" ? { previousDigest: "sha256:mismatched-on-purpose" } : {};

          const { report, manifestEntry } = runQuarantinePipeline(source, options);

          const expectedPrefixLength = {
            none: 6,
            fetch: 1,
            provenance: 3,
            scan: 4,
            sandbox: 5,
          }[failAt];
          expect(report.stages.map((s) => s.stage)).toEqual(
            PIPELINE_STAGES.slice(0, expectedPrefixLength),
          );
          // Every stage recorded except possibly the last one passed; the
          // last one passed iff we reached the full 6-stage prefix.
          for (let i = 0; i < report.stages.length - 1; i += 1) {
            expect(report.stages[i]?.passed).toBe(true);
          }
          const reachedManifestEntry = expectedPrefixLength === 6;
          expect(report.stages.at(-1)?.passed).toBe(reachedManifestEntry);
          expect(manifestEntry !== undefined).toBe(reachedManifestEntry);
          expect(report.decision).toBe(reachedManifestEntry ? "pending" : "rejected");
        },
      ),
      { numRuns: 50 },
    );
  });
});
