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

import { DEFAULT_COMMUNICATION_POLICY, type CommunicationPolicy } from "@crabgic/contracts";
import type { LintFinding } from "@crabgic/renderer";
import { renderWithRegeneration } from "@crabgic/renderer";
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

/** commitlint's `footer-max-line-length`, and the width this repo's own config inherits. */
const FOOTER_MAX_LINE_LENGTH = 100;

/**
 * Lowers ONLY the first letter.
 *
 * `outcome` comes from a `WorkUnit`/`Requirement` title, which humans
 * conventionally capitalise, and commitlint's `subject-case` rule rejects
 * sentence-case. Lowercasing the whole subject would be worse than the problem
 * it solves: it mangles `TaskPacket` into `taskpacket`. The rule objects to
 * sentence-case, not to capitals anywhere.
 */
function lowerFirst(text: string): string {
  return text.length === 0 ? text : `${text[0]!.toLowerCase()}${text.slice(1)}`;
}

/**
 * Wraps one footer line at `FOOTER_MAX_LINE_LENGTH`, continuing on indented
 * lines so the trailer key stays at a line start and the footer stays
 * parseable. Never splits a word — an over-long token (a path, typically) is
 * left whole and over-length rather than corrupted, because a broken path is a
 * worse outcome than a long line.
 */
function wrapFooterLine(key: string, value: string): readonly string[] {
  const lines: string[] = [];
  let current = `${key} `;
  for (const word of value.split(/\s+/).filter((part) => part.length > 0)) {
    if (
      current.trimEnd().length > key.length &&
      `${current}${word}`.length > FOOTER_MAX_LINE_LENGTH
    ) {
      lines.push(current.trimEnd());
      current = `  ${word} `;
    } else {
      current = `${current}${word} `;
    }
  }
  lines.push(current.trimEnd());
  return lines;
}

/**
 * Trims `text` to at most `maxChars`, at a WORD boundary where there is one.
 *
 * No ellipsis, deliberately: commitlint's `subject-full-stop` rejects a
 * trailing period, so `...` would trade one block for another. A single token
 * longer than the whole budget has no boundary to cut at and is hard-cut —
 * trimming it to nothing would leave `type: `, which fails the format check.
 * The same emptying is reachable through the word-boundary arm (a hard cut
 * whose prefix is all punctuation), so the non-empty guard is applied to the
 * trim's RESULT rather than to the single-token branch alone.
 */
function trimToWidth(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const hardCut = text.slice(0, maxChars);
  const lastSpace = hardCut.lastIndexOf(" ");
  if (lastSpace <= 0) return hardCut;
  const atBoundary = hardCut.slice(0, lastSpace).replace(/[\s,;:.-]+$/u, "");
  // ⚠️ THE WORD-BOUNDARY ARM EMPTIES TOO. `lastSpace > 0` guarantees a
  // non-empty slice but not a non-empty RESULT: for `--- <one long token>`
  // the slice is `---` and the punctuation strip takes all of it, leaving the
  // `type: ` subject the guard above was written to prevent. The guard has to
  // sit on the result, so both arms are covered by one rule.
  return atBoundary.length > 0 ? atBoundary : hardCut;
}

/**
 * ⚠️ THE OUTCOME IS BOUNDED HERE, and it has to be — measured in production,
 * run `70059608` (2026-09-06).
 *
 * A `WorkUnit` title is human-authored and routinely longer than the policy's
 * subject budget: two of that run's four units rendered 75- and 76-char
 * subjects. `renderWithRegeneration` blocked them, `collectCandidate` returned
 * `blocked`, and a unit's finished work — 34 worker turns, $1.57 — was never
 * committed. Regeneration cannot rescue a DETERMINISTIC generator: it re-runs
 * `generate`, which reassembles the identical over-long string.
 *
 * The budget is the POLICY's own (`commitSubject.maxChars`), never a second
 * copy of the number, and the prefix is subtracted from it so `type(scope): `
 * is paid for rather than assumed. Trimming is assembly, not authorship: no
 * word here is one this module invented.
 */
export function assembleCommitSubject(
  input: RenderCommitInput,
  policy: CommunicationPolicy = DEFAULT_COMMUNICATION_POLICY,
): string {
  const prefix = input.scope !== undefined ? `${input.type}(${input.scope})` : input.type;
  const budget = policy.limits.commitSubject.maxChars - `${prefix}: `.length;
  return `${prefix}: ${trimToWidth(lowerFirst(input.outcome), budget)}`;
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
 * Wraps an assembled body to commitlint's footer width, AFTER the policy has
 * judged it.
 *
 * The order is the whole point. `CommunicationPolicy` caps a commit body at
 * five lines, and that cap is about how much a human must READ — one logical
 * line per trailer key. Wrapping before the check would let display width
 * decide a content question: a long `rollbackStrategy` would push the body past
 * five wrapped lines and get blocked for being wide rather than for saying too
 * much, and (measured while writing this) collapsing the author's own newlines
 * into spaces would let a genuinely six-line body slip through the guard
 * entirely.
 *
 * So each line is wrapped INDEPENDENTLY and hard breaks are preserved: the
 * policy counts entries, commitlint counts columns, and neither decides the
 * other's question.
 */
export function wrapCommitFooter(body: string): string {
  return body
    .split("\n")
    .flatMap((line) => {
      const separator = line.indexOf(":");
      if (separator < 0) return [line];
      return wrapFooterLine(line.slice(0, separator + 1), line.slice(separator + 1).trim());
    })
    .join("\n");
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
    generate: () => assembleCommitSubject(input, policy),
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
    // Wrapped only now, once the policy has judged the content — see
    // `wrapCommitFooter` for why that order is load-bearing.
    body: wrapCommitFooter(bodyOutcome.artifact.content),
  };
}
