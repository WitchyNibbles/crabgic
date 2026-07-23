import { checkLimit, countChars, countLines, type CommunicationPolicy } from "@eo/contracts";
import type { ArtifactKind } from "./artifact-kind.js";
import type { LintFinding, LintStageInput } from "./lint-types.js";

/**
 * Whitespace/line/length-limits stage — roadmap/17 §Goal pipeline bullet:
 * "whitespace/line/length limits per `ArtifactKind` (read from
 * `CommunicationPolicy`, 02, at call time — never hardcoded)." The limit
 * object for each kind is read from the caller-supplied `policy` argument
 * every call — there is no local constant duplicating `02`'s numbers.
 */

export const STAGE_NAME_LENGTH_LIMITS = "length-limits";

/**
 * Maps an `ArtifactKind` to its `CommunicationPolicy.limits` slice. Every
 * value here is read directly off the `policy` parameter passed to the
 * stage — this function never inlines a numeric literal.
 */
function limitFor(kind: ArtifactKind, policy: CommunicationPolicy) {
  switch (kind) {
    case "branch_name":
      return policy.limits.branchName;
    case "commit_subject":
      return policy.limits.commitSubject;
    case "commit_body":
      return policy.limits.commitBody;
    case "pr_title":
      return policy.limits.prTitle;
    case "pr_body":
      return policy.limits.prBody;
    case "review_comment":
      return policy.limits.reviewComment;
    case "jira_milestone_comment":
      return policy.limits.jiraComment;
    case "grafana_annotation":
      return policy.limits.grafanaAnnotation;
  }
}

function trailingWhitespaceFindings(text: string): LintFinding[] {
  const findings: LintFinding[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const trimmedEnd = line.replace(/[ \t]+$/, "");
    if (trimmedEnd.length !== line.length) {
      findings.push({
        stage: STAGE_NAME_LENGTH_LIMITS,
        severity: "block",
        message: "trailing whitespace is not permitted at the end of a line",
        span: { start: offset + trimmedEnd.length, end: offset + line.length },
      });
    }
    offset += line.length + 1;
  }
  return findings;
}

export function lengthLimitsStage(input: LintStageInput): readonly LintFinding[] {
  const { candidate, kind, policy } = input;
  const findings: LintFinding[] = [];
  const limit = limitFor(kind, policy);

  if (!checkLimit(candidate, limit)) {
    const chars = countChars(candidate);
    const lines = countLines(candidate);
    const parts: string[] = [];
    if ("maxChars" in limit && chars > limit.maxChars) {
      parts.push(`${chars} chars exceeds the ${limit.maxChars}-char limit for "${kind}"`);
    }
    if ("maxLines" in limit && lines > limit.maxLines) {
      parts.push(`${lines} lines exceeds the ${limit.maxLines}-line limit for "${kind}"`);
    }
    findings.push({
      stage: STAGE_NAME_LENGTH_LIMITS,
      severity: "block",
      message: parts.length > 0 ? parts.join("; ") : `"${kind}" exceeds its CommunicationPolicy limit`,
    });
  }

  findings.push(...trailingWhitespaceFindings(candidate));

  return findings;
}
