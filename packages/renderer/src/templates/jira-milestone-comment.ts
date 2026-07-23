/**
 * Jira milestone comment template — roadmap/17 §Templates:
 * "Jira milestone comment (Outcome/Evidence/Risk/Next/Ref)." A pure string
 * builder; length/section enforcement happens when the caller runs the
 * output through `lint()` — this function does not self-validate.
 */
export interface JiraMilestoneCommentInput {
  readonly outcome: string;
  readonly evidence: string;
  readonly risk: string;
  readonly next: string;
  readonly ref: string;
}

export function renderJiraMilestoneComment(input: JiraMilestoneCommentInput): string {
  return [
    `Outcome: ${input.outcome}`,
    `Evidence: ${input.evidence}`,
    `Risk: ${input.risk}`,
    `Next: ${input.next}`,
    `Ref: ${input.ref}`,
  ].join("\n");
}
