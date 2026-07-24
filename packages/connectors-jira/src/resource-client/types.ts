import type { RemoteMutationPlan } from "@eo/contracts";
import type { JiraStatusCategoryKey } from "../workflow/workflow-stage.js";

/**
 * Domain shapes this connector validates every Jira REST response against
 * (roadmap/18 RULES: "Validate all external API responses at the
 * boundary (never trust Jira's response shape)" — see `./schemas.ts` for
 * the zod validators these types mirror).
 */
export interface JiraProject {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface JiraBoard {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly projectKey?: string;
}

export type JiraSprintState = "future" | "active" | "closed";

export interface JiraSprint {
  readonly id: number;
  readonly name: string;
  readonly state: JiraSprintState;
  readonly boardId: number;
  readonly startDate?: string;
  readonly endDate?: string;
}

export interface JiraIssueStatus {
  readonly name: string;
  readonly statusCategoryKey?: JiraStatusCategoryKey;
}

export interface JiraIssue {
  readonly key: string;
  readonly id: string;
  readonly summary: string;
  readonly issueType: string;
  readonly status: JiraIssueStatus;
  readonly revision: string;
  /** Raw discovered field values keyed by field ID — never blindly trusted for a WRITE (custom-field writes are validated separately against discovered field metadata), but safe to read/display. */
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface JiraIssueSearchResult {
  readonly issues: readonly JiraIssue[];
  readonly nextPageToken?: string;
}

export interface JiraComment {
  readonly id: string;
  readonly bodyAdf: unknown;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly updatedRevision: string;
}

export interface JiraWorklog {
  readonly id: string;
  readonly timeSpentSeconds: number;
  readonly comment?: unknown;
}

export interface JiraIssueLink {
  readonly id: string;
  readonly linkType: string;
  readonly outwardIssueKey?: string;
  readonly inwardIssueKey?: string;
}

/** A discovered field-metadata entry — roadmap/18 §In scope: "custom-field writes only against discovered field metadata." */
export interface JiraFieldMetadata {
  readonly id: string;
  readonly name: string;
  readonly custom: boolean;
  /** Jira's own field schema `type` (e.g. `string`, `number`, `array`, `option`, `user`) — an unrecognized type must never be silently accepted for a custom-field write. */
  readonly schemaType: string;
}

export interface JiraTransition {
  readonly id: string;
  readonly name: string;
  readonly toStatusName: string;
  readonly toStatusCategoryKey?: JiraStatusCategoryKey;
}

/**
 * `JiraResourceClient` — roadmap/18 §Interfaces produced: "deployment-
 * type-parameterized resource-client interface... covering projects/
 * boards/sprints/epics/issues/comments/links/worklogs/attachments; every
 * method is typed IO, every failure mapped to exactly one of P02's 10
 * canonical connector errors."
 *
 * Read/search methods perform network I/O and return validated domain
 * objects. `plan*` methods are PURE and LOCAL — no network I/O — they
 * build a `RemoteMutationPlan` the caller submits through 16's mutation
 * pipeline (`tracker.apply`); this mirrors `@eo/gateway`'s own fake-
 * tracker-provider doc comment: "planning is local-only; no network call
 * in the real implementation." Epics are not a separate namespace: Jira
 * models an epic as an issue whose `issueType` is `"Epic"`, so epic
 * operations are `issues.*` calls with that issue type.
 */
export interface JiraResourceClient {
  readonly projects: {
    list(): Promise<readonly JiraProject[]>;
    get(projectKeyOrId: string): Promise<JiraProject>;
  };
  readonly boards: {
    list(projectKeyOrId?: string): Promise<readonly JiraBoard[]>;
    get(boardId: number): Promise<JiraBoard>;
    planCreate(
      input: { readonly name: string; readonly type: string; readonly projectKeyOrId: string },
      envelopeId: string,
    ): RemoteMutationPlan;
    planUpdate(
      boardId: number,
      patch: { readonly name?: string },
      envelopeId: string,
    ): RemoteMutationPlan;
    planRankIssues(
      boardId: number,
      input: { readonly issueKeys: readonly string[]; readonly rankBeforeIssueKey?: string },
      envelopeId: string,
    ): RemoteMutationPlan;
  };
  readonly sprints: {
    list(boardId: number): Promise<readonly JiraSprint[]>;
    get(sprintId: number): Promise<JiraSprint>;
    planCreate(
      input: {
        readonly boardId: number;
        readonly name: string;
        readonly startDate?: string;
        readonly endDate?: string;
      },
      envelopeId: string,
    ): RemoteMutationPlan;
    planStart(sprintId: number, expectedRevision: string, envelopeId: string): RemoteMutationPlan;
    planComplete(
      sprintId: number,
      expectedRevision: string,
      envelopeId: string,
    ): RemoteMutationPlan;
    planMoveIssues(
      sprintId: number,
      issueKeys: readonly string[],
      envelopeId: string,
    ): RemoteMutationPlan;
  };
  readonly issues: {
    search(jql: string, pageToken?: string): Promise<JiraIssueSearchResult>;
    get(issueKey: string): Promise<JiraIssue>;
    transitions(issueKey: string): Promise<readonly JiraTransition[]>;
    planCreate(
      input: {
        readonly projectKeyOrId: string;
        readonly issueType: string;
        readonly summaryAdf: unknown;
        readonly fields?: Readonly<Record<string, unknown>>;
      },
      envelopeId: string,
    ): RemoteMutationPlan;
    planUpdate(
      issueKey: string,
      expectedRevision: string,
      fields: Readonly<Record<string, unknown>>,
      envelopeId: string,
    ): RemoteMutationPlan;
    /**
     * HIGH H2 (adversarial-review) fix: `targetStageIsDone` is
     * deliberately NOT a parameter here — a caller-supplied boolean could
     * be forged `false` for a genuinely closing `transitionId`, which
     * would skip both `hasVerificationEvidence`'s gate and the
     * `closing transitions` high-impact flag while the POST still closes
     * the issue on the wire. This method resolves the transition's REAL
     * target status itself, via `issues.transitions(issueKey)` (a
     * deliberate, narrow exception to "planning is local-only" — one
     * read call, never more) — `JiraTransition.toStatusCategoryKey` per
     * transition, already exposed by that method, feeds
     * `mapJiraStatusToWorkflowStage` exactly as the never-guess mapper
     * intends. An unrecognized
     * `transitionId` (absent from the server's own reported list) is
     * refused outright — never guessed.
     *
     * `hasVerificationEvidence` gates any transition whose SERVER-
     * resolved target stage is `done` — roadmap/18 §In scope: "Jira
     * `done` only after 21's exact-revision verification passes."
     * Defaults to `false`: refused pre-flight, never silently permitted.
     * 21 passes `true` once it has performed that verification.
     */
    planTransition(
      issueKey: string,
      expectedRevision: string,
      transitionId: string,
      envelopeId: string,
      hasVerificationEvidence?: boolean,
    ): Promise<RemoteMutationPlan>;
    planLink(
      input: {
        readonly linkType: string;
        readonly outwardIssueKey: string;
        readonly inwardIssueKey: string;
      },
      envelopeId: string,
    ): RemoteMutationPlan;
    planBulkUpdate(
      issueKeys: readonly string[],
      fields: Readonly<Record<string, unknown>>,
      envelopeId: string,
    ): RemoteMutationPlan;
    planBulkTransition(
      issueKeys: readonly string[],
      transitionId: string,
      envelopeId: string,
    ): RemoteMutationPlan;
  };
  readonly comments: {
    list(issueKey: string): Promise<readonly JiraComment[]>;
    planCreate(
      issueKey: string,
      bodyAdf: unknown,
      marker: string,
      envelopeId: string,
    ): RemoteMutationPlan;
    planUpdate(
      issueKey: string,
      commentId: string,
      expectedRevision: string,
      bodyAdf: unknown,
      envelopeId: string,
    ): RemoteMutationPlan;
  };
  readonly worklogs: {
    list(issueKey: string): Promise<readonly JiraWorklog[]>;
    planCreate(
      issueKey: string,
      input: { readonly timeSpentSeconds: number; readonly comment?: unknown },
      envelopeId: string,
    ): RemoteMutationPlan;
  };
  readonly attachments: {
    planUpload(
      issueKey: string,
      staged: { readonly stagingId: string; readonly filename: string; readonly sizeBytes: number },
      envelopeId: string,
    ): RemoteMutationPlan;
  };
}
