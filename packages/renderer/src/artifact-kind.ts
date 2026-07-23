/**
 * `ArtifactKind` — roadmap/17-renderer-communication-lint.md §Interfaces
 * produced: "name introduced here — closed union." Every shared-text
 * artifact `lint()`/`renderWithRegeneration()` can produce. Consumed by 08
 * (the first six members), 18 (`jira_milestone_comment` + `toADF`), 19
 * (`jira_milestone_comment` via `toWikiMarkup`), 20 (`grafana_annotation`).
 *
 * Deliberately excludes `release_notes`/`code_comment`/`doc_prose` as named
 * members with a calling phase (roadmap/17 §Risks & open questions,
 * "Scoping note") — the golden/property corpus still exercises the stage
 * pipeline against fixtures shaped like these classes for regression
 * coverage, but no phase 00-23 calls `renderWithRegeneration` with those
 * kinds today.
 */
export const ARTIFACT_KINDS = [
  "branch_name",
  "commit_subject",
  "commit_body",
  "pr_title",
  "pr_body",
  "review_comment",
  "jira_milestone_comment",
  "grafana_annotation",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === "string" && (ARTIFACT_KINDS as readonly string[]).includes(value);
}
