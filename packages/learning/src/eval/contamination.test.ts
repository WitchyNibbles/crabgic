import { describe, expect, it } from "vitest";
import { assertNoContamination, detectContamination } from "./contamination.js";
import { ContaminationDetectedError } from "../errors.js";
import { EvalCaseSchema } from "./case-schema.js";

function makeCase(
  id: string,
  provenanceId: string,
  command: string,
): ReturnType<typeof EvalCaseSchema.parse> {
  return EvalCaseSchema.parse({
    id,
    input: { command },
    expectedJudgment: true,
    provenanceId,
  });
}

describe("detectContamination", () => {
  it("reports no contamination for genuinely disjoint dev/held-out sets", () => {
    const dev = [makeCase("d1", "prov-dev-1", "npm test")];
    const heldOut = [makeCase("h1", "prov-held-1", "npm build")];
    const report = detectContamination(dev, heldOut);
    expect(report.contaminated).toBe(false);
    expect(report.overlappingCaseHashes).toEqual([]);
    expect(report.overlappingProvenanceIds).toEqual([]);
  });

  it("detects a case-hash overlap (same content, different provenance/ids)", () => {
    const dev = [makeCase("d1", "prov-dev-1", "npm test")];
    const heldOut = [makeCase("h1", "prov-held-1", "npm test")]; // identical input+judgment
    const report = detectContamination(dev, heldOut);
    expect(report.contaminated).toBe(true);
    expect(report.overlappingCaseHashes).toHaveLength(1);
    expect(report.overlappingProvenanceIds).toEqual([]);
  });

  it("detects a shared-provenance overlap even when case content differs", () => {
    const dev = [makeCase("d1", "shared-prov", "npm test")];
    const heldOut = [makeCase("h1", "shared-prov", "npm build")];
    const report = detectContamination(dev, heldOut);
    expect(report.contaminated).toBe(true);
    expect(report.overlappingProvenanceIds).toEqual(["shared-prov"]);
  });

  it("assertNoContamination throws ContaminationDetectedError when contaminated", () => {
    const dev = [makeCase("d1", "prov-1", "npm test")];
    const heldOut = [makeCase("h1", "prov-1", "npm test")];
    expect(() => assertNoContamination(dev, heldOut)).toThrow(ContaminationDetectedError);
  });

  it("assertNoContamination does not throw for disjoint sets", () => {
    const dev = [makeCase("d1", "prov-dev", "npm test")];
    const heldOut = [makeCase("h1", "prov-held", "npm build")];
    expect(() => assertNoContamination(dev, heldOut)).not.toThrow();
  });

  it("does not mutate either input array", () => {
    const dev = [makeCase("d1", "prov-dev", "npm test")];
    const heldOut = [makeCase("h1", "prov-held", "npm build")];
    const devCopy = [...dev];
    const heldOutCopy = [...heldOut];
    detectContamination(dev, heldOut);
    expect(dev).toEqual(devCopy);
    expect(heldOut).toEqual(heldOutCopy);
  });
});
