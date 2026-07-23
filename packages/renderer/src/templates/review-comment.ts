/**
 * Review comment template — roadmap/17 §Templates: "review comment (one
 * finding, evidence, action, ≤6 lines)."
 */
export interface ReviewCommentInput {
  readonly finding: string;
  readonly evidence: string;
  readonly action: string;
}

export function renderReviewComment(input: ReviewCommentInput): string {
  return [
    `Finding: ${input.finding}`,
    `Evidence: ${input.evidence}`,
    `Action: ${input.action}`,
  ].join("\n");
}
