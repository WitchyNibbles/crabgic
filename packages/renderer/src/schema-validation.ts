import type { ArtifactKind } from "./artifact-kind.js";
import type { LintFinding, LintStageInput } from "./lint-types.js";

/**
 * Action-specific schema-validation stage — roadmap/17 §Goal pipeline's
 * first arrow: "action-specific schema validation (unknown fields
 * rejected)." Two structural checks, both driven by `CommunicationPolicy`
 * (02) at call time rather than a hardcoded literal:
 *
 * - Conventional-commit FORMAT check for `commit_subject`/`pr_title`
 *   (`policy.limits.<kind>.format`, literally `"type(scope): outcome"`):
 *   single line, `type` or `type(scope)` prefix, non-empty description.
 * - SECTION-SHAPE check for the three templated multi-line kinds
 *   (`pr_body`, `jira_milestone_comment`, `review_comment`): every
 *   `Label: value` line's label must be one of the kind's declared section
 *   names (`policy.limits.prBody.sections`,
 *   `policy.limits.jiraComment.milestoneTemplate`,
 *   `policy.limits.reviewComment.shape`) — an unrecognized label is an
 *   "unknown field," rejected; a declared section that never appears is a
 *   missing required section, also rejected. `branch_name`, `commit_body`,
 *   `grafana_annotation` have no section/format shape of their own and are
 *   a structural no-op at this stage (their own length/format constraints,
 *   if any, are enforced by other stages).
 */

export const STAGE_NAME_SCHEMA_VALIDATION = "schema-validation";

const CONVENTIONAL_FORMAT_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*(\([^)]+\))?: \S.*$/;

function capitalize(word: string): string {
  return word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1);
}

interface SectionSpec {
  readonly labels: readonly string[];
}

function sectionSpecFor(
  kind: ArtifactKind,
  policy: LintStageInput["policy"],
): SectionSpec | undefined {
  switch (kind) {
    case "pr_body":
      return { labels: policy.limits.prBody.sections };
    case "jira_milestone_comment":
      return { labels: policy.limits.jiraComment.milestoneTemplate };
    case "review_comment":
      return { labels: policy.limits.reviewComment.shape.map(capitalize) };
    default:
      return undefined;
  }
}

function validateFormat(candidate: string, kind: ArtifactKind, format: string): LintFinding[] {
  if (candidate.includes("\n")) {
    return [
      {
        stage: STAGE_NAME_SCHEMA_VALIDATION,
        severity: "block",
        message: `"${kind}" must be a single line matching the "${format}" format`,
      },
    ];
  }
  if (!CONVENTIONAL_FORMAT_PATTERN.test(candidate)) {
    return [
      {
        stage: STAGE_NAME_SCHEMA_VALIDATION,
        severity: "block",
        message: `"${kind}" does not match the required "${format}" format`,
      },
    ];
  }
  return [];
}

function validateSections(candidate: string, kind: ArtifactKind, spec: SectionSpec): LintFinding[] {
  const findings: LintFinding[] = [];
  const seen = new Set<string>();
  let offset = 0;

  for (const line of candidate.split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9 _-]*):\s?(.*)$/.exec(line);
    if (match) {
      const label = match[1]!;
      if (spec.labels.includes(label)) {
        seen.add(label);
      } else {
        findings.push({
          stage: STAGE_NAME_SCHEMA_VALIDATION,
          severity: "block",
          message: `unknown section field "${label}" is not part of the "${kind}" template (expected one of: ${spec.labels.join(", ")})`,
          span: { start: offset, end: offset + label.length },
        });
      }
    }
    offset += line.length + 1;
  }

  for (const label of spec.labels) {
    if (!seen.has(label)) {
      findings.push({
        stage: STAGE_NAME_SCHEMA_VALIDATION,
        severity: "block",
        message: `required section "${label}" is missing from the "${kind}" template`,
      });
    }
  }

  return findings;
}

export function schemaValidationStage(input: LintStageInput): readonly LintFinding[] {
  const { candidate, kind, policy } = input;

  if (kind === "commit_subject") {
    return validateFormat(candidate, kind, policy.limits.commitSubject.format);
  }
  if (kind === "pr_title") {
    return validateFormat(candidate, kind, policy.limits.prTitle.format);
  }

  const sectionSpec = sectionSpecFor(kind, policy);
  if (sectionSpec) {
    return validateSections(candidate, kind, sectionSpec);
  }

  return [];
}
