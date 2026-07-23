/**
 * PR title template — roadmap/17 §Templates: "PR title (≤72 chars,
 * `type(scope): outcome` — same convention as the commit subject, 08)."
 */
export interface PrTitleInput {
  readonly type: string;
  readonly scope?: string;
  readonly outcome: string;
}

export function renderPrTitle(input: PrTitleInput): string {
  const prefix = input.scope !== undefined ? `${input.type}(${input.scope})` : input.type;
  return `${prefix}: ${input.outcome}`;
}
