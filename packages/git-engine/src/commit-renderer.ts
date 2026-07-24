/**
 * Commit renderer — roadmap/08-integration-publication.md work item 4:
 * "Commit renderer (`renderCommit`) on the same `renderWithRegeneration()`
 * path for `commit_subject`/`commit_body` + golden corpus (bad subjects,
 * over-long bodies, attribution leaks — shared fixture with 17). Failing-
 * first: the golden corpus must fail red before the renderer exists."
 * §Interfaces produced: "`renderCommit(workUnit): { subject: string, body:
 * string }` — assembles the `type(scope): outcome` candidate from
 * already-produced structured fields, rendered via 17's
 * `renderWithRegeneration()` for `commit_subject`/`commit_body`."
 *
 * NO FREE-TEXT AUTHORSHIP (roadmap, verbatim): every field below is a
 * caller-supplied STRUCTURED value already produced upstream (a
 * `ChangeSet`/`WorkUnit`/`Requirement`'s own title/outcome/acceptance-
 * criteria text) — this module only assembles a template from them, it
 * never generates new prose itself.
 */

import { DEFAULT_COMMUNICATION_POLICY, type CommunicationPolicy } from "@eo/contracts";
import type { LintFinding } from "@eo/renderer";
import { renderWithRegeneration } from "@eo/renderer";
import { BRANCH_TYPES, type BranchType } from "./branch-namer.js";

/** The same closed `type` set branch names use (roadmap §Templates: the commit-subject/PR-title `type(scope): outcome` convention is shared). */
export const COMMIT_TYPES = BRANCH_TYPES;
export type CommitType = BranchType;

export interface RenderCommitInput {
  readonly type: CommitType;
  readonly scope?: string;
  /** The `outcome` clause of `type(scope): outcome` — sourced from the `WorkUnit`/`Requirement`'s own title/description, never freshly authored. */
  readonly outcome: string;
  /** Why this change was made — sourced from the `Requirement`'s own description/acceptance criteria. */
  readonly why: string;
  /** What risk this change carries — sourced from structured evidence, never free prose. */
  readonly risk: string;
  /** Compatibility note — sourced from structured evidence. */
  readonly compat: string;
  /** How this was verified — sourced from the `Requirement`'s `evidenceRecordIds`/`testIdentifiers` summary. */
  readonly verification: string;
}

export type RenderCommitResult =
  | { readonly status: "rendered"; readonly subject: string; readonly body: string }
  | {
      readonly status: "blocked";
      readonly error: "policy_blocked";
      readonly which: "subject" | "body";
      readonly findings: readonly LintFinding[];
    };

export function assembleCommitSubject(input: RenderCommitInput): string {
  const prefix = input.scope !== undefined ? `${input.type}(${input.scope})` : input.type;
  return `${prefix}: ${input.outcome}`;
}

export function assembleCommitBody(input: RenderCommitInput): string {
  return [
    `Why: ${input.why}`,
    `Risk: ${input.risk}`,
    `Compat: ${input.compat}`,
    `Verification: ${input.verification}`,
  ].join("\n");
}

/**
 * `renderCommit(input, policy)` — see file-level doc comment for the
 * documented input shape (structured fields, not a bare `WorkUnit`, so the
 * caller's own assembly from `ChangeSet`/`WorkUnit`/`Requirement` stays
 * explicit at the call site rather than this module reaching into those
 * contracts' fields itself). Both `commit_subject` and `commit_body` are
 * rendered independently through 17's `renderWithRegeneration()`; either
 * one blocking is surfaced as this function's own `blocked` outcome,
 * converging on the same `policy_blocked` terminal every other rendered
 * artifact in this phase does.
 */
export async function renderCommit(
  input: RenderCommitInput,
  policy: CommunicationPolicy = DEFAULT_COMMUNICATION_POLICY,
): Promise<RenderCommitResult> {
  const subjectOutcome = await renderWithRegeneration({
    kind: "commit_subject",
    policy,
    generate: () => assembleCommitSubject(input),
  });
  if (subjectOutcome.status === "blocked") {
    return {
      status: "blocked",
      error: "policy_blocked",
      which: "subject",
      findings: subjectOutcome.findings,
    };
  }

  const bodyOutcome = await renderWithRegeneration({
    kind: "commit_body",
    policy,
    generate: () => assembleCommitBody(input),
  });
  if (bodyOutcome.status === "blocked") {
    return {
      status: "blocked",
      error: "policy_blocked",
      which: "body",
      findings: bodyOutcome.findings,
    };
  }

  return {
    status: "rendered",
    subject: subjectOutcome.artifact.content,
    body: bodyOutcome.artifact.content,
  };
}
