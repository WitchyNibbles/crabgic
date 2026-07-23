import type { LintFinding, LintStageInput } from "./lint-types.js";

/**
 * Mention/notification-policy stage — roadmap/17 §Goal pipeline's final
 * arrow. `CommunicationPolicy` (02) defines no mention allowlist field of
 * its own (the `mentions` prohibited-content category exists, but no
 * per-connection allowlist constant is modeled in 02's schema today) — this
 * stage's documented reading is therefore "the allowlist is empty," i.e.
 * every `@`-mention/notification-triggering token is rejected outright.
 * Deliberately excludes ordinary email addresses (`user@example.com`) from
 * the match: a mention handle is never immediately preceded by a word
 * character.
 */

export const STAGE_NAME_MENTION_POLICY = "mention-policy";

const MENTION_PATTERN = /(?<![A-Za-z0-9._-])@[A-Za-z0-9_-]+/g;

function findAllMatches(text: string, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  const re = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    matches.push(match);
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return matches;
}

export function mentionPolicyStage(input: LintStageInput): readonly LintFinding[] {
  return findAllMatches(input.candidate, MENTION_PATTERN).map((match) => ({
    stage: STAGE_NAME_MENTION_POLICY,
    severity: "block" as const,
    message: `mention/notification-triggering token "${match[0]}" is not on the mention/notification policy's allowlist`,
    span: { start: match.index, end: match.index + match[0].length },
  }));
}
