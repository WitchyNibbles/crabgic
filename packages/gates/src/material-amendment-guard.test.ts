import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildMaterialAmendmentSignal } from "./materiality-classifier.js";
import {
  MaterialAmendmentDetectedError,
  throwIfMaterialAmendment,
} from "./material-amendment-guard.js";

/**
 * MAJOR-1 fix (adversarial-validation round): a minimal, testable proof
 * that this phase's own `MaterialAmendmentSignal` WOULD halt a run before
 * `final_verifying` completes — 21 supplies the trigger signal; 11 owns the
 * real stop-condition/re-approval mechanics (not re-implemented here).
 */
describe("throwIfMaterialAmendment — failing-first: a material signal halts", () => {
  it("throws MaterialAmendmentDetectedError when signal.material is true", () => {
    const requirementId = randomUUID();
    const signal = buildMaterialAmendmentSignal(requirementId, [
      { field: "description", before: "old", after: "new" },
    ]);
    expect(() => throwIfMaterialAmendment(signal)).toThrow(MaterialAmendmentDetectedError);
    try {
      throwIfMaterialAmendment(signal);
    } catch (error) {
      expect(error).toBeInstanceOf(MaterialAmendmentDetectedError);
      expect((error as MaterialAmendmentDetectedError).signal).toEqual(signal);
      expect((error as Error).message).toContain(requirementId);
      expect((error as Error).message).toContain("description");
    }
  });

  it("is a no-op (never throws) when signal.material is false", () => {
    const signal = buildMaterialAmendmentSignal(randomUUID(), [
      { field: "watchers", before: "[a]", after: "[a,b]" },
    ]);
    expect(() => throwIfMaterialAmendment(signal)).not.toThrow();
  });
});
