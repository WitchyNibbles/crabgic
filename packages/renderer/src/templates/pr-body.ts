/**
 * PR body template — roadmap/17 §Templates: "PR body (Outcome/Validation/
 * Risk/Tracking ≤12 lines)."
 */
export interface PrBodyInput {
  readonly outcome: string;
  readonly validation: string;
  readonly risk: string;
  readonly tracking: string;
}

export function renderPrBody(input: PrBodyInput): string {
  return [
    `Outcome: ${input.outcome}`,
    `Validation: ${input.validation}`,
    `Risk: ${input.risk}`,
    `Tracking: ${input.tracking}`,
  ].join("\n");
}
