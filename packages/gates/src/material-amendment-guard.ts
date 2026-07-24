import type { MaterialAmendmentSignal } from "./materiality-classifier.js";

/**
 * Thrown by `throwIfMaterialAmendment` when a `MaterialAmendmentSignal`'s
 * own `material` field is `true` — roadmap/21 §In scope: "a material diff
 * raises 11's `material amendment` stop condition ... 21 supplies the
 * trigger signal, 11 owns the amendment/re-approval mechanics." This typed
 * error is NOT 11's real stop-condition/re-approval machinery (out of this
 * phase's scope) — it is this phase's own minimal, testable proof that the
 * signal it emits WOULD halt a run before `final_verifying` completes, were
 * 11's real consumer wired to it (as it already is, transitively,
 * 21→14→13→11, per the roadmap's own dependency framing).
 */
export class MaterialAmendmentDetectedError extends Error {
  constructor(readonly signal: MaterialAmendmentSignal) {
    super(
      `gates: material amendment detected for requirement "${signal.requirementId}" ` +
        `(fields: ${signal.materialFields.join(", ")}) — halting before final_verifying; ` +
        `11's stop condition owns re-approval from here.`,
    );
    this.name = "MaterialAmendmentDetectedError";
  }
}

/** Throws `MaterialAmendmentDetectedError` iff `signal.material` is `true`; a no-op otherwise. */
export function throwIfMaterialAmendment(signal: MaterialAmendmentSignal): void {
  if (signal.material) {
    throw new MaterialAmendmentDetectedError(signal);
  }
}
