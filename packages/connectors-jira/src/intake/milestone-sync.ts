import { DEFAULT_COMMUNICATION_POLICY, type CommunicationPolicy } from "@crabgic/contracts";
import type { MarkerReconciler } from "@crabgic/gateway";
import {
  renderJiraMilestoneComment,
  renderWithRegeneration,
  toADF,
  validateAdfSafeSubset,
  type LintFinding,
} from "@crabgic/renderer";
import type { RemoteResource } from "@crabgic/contracts";
import type { JiraResourceClient } from "../resource-client/types.js";
import {
  compareRemoteResourceRevisions,
  stampJiraRemoteResource,
  type MaterialChangeSignal,
} from "./revision-comparator.js";

/**
 * Milestone-sync engine — roadmap/18 §In scope: "Milestone-only updates
 * (start / material blocker / verified completion) via 17's Jira
 * milestone-comment template; status-comment dedup by entity-property
 * marker (edit in place, never a second comment)." §Exit criteria:
 * "Milestone sync yields ≤1 status comment per milestone, edited in
 * place."
 *
 * Also §Interfaces produced: "stamps each intake-tracked issue's
 * `RemoteResource` (P02 schema) instance with its exact remote revision at
 * every milestone poll; diffing two consecutive stamps is the
 * material-change signal." That is the OPT-IN `revisionPoll` surface below
 * — this module is the milestone poll `./revision-comparator.ts` names, and
 * its only caller inside this package.
 *
 * One marker PER (issueKey, milestone kind) — a "start" sync and a
 * "verified_completion" sync for the SAME issue are different milestones
 * and get their own comment/marker; a SECOND "start" sync (e.g. a re-run)
 * edits the first "start" comment in place, never creates a second one.
 */
export const MILESTONE_EVENT_KINDS = ["start", "material_blocker", "verified_completion"] as const;
export type MilestoneEventKind = (typeof MILESTONE_EVENT_KINDS)[number];

/**
 * Opt-in revision-poll request. Absent => this sync performs no remote
 * read and reports no `revisionPoll` outcome, which is why adding it
 * changed none of this module's pre-existing behaviour or tests.
 */
export interface MilestoneRevisionPollInput {
  /** Identity for the `RemoteResource` stamp — P02's schema requires it. */
  readonly externalConnectionId: string;
  /**
   * The PREVIOUS poll's stamp; absent on the first poll of a cycle, in
   * which case no signal is produced (there is nothing to diff against —
   * a first poll must never be reported as a material change).
   */
  readonly previousStamp?: RemoteResource;
}

export interface MilestoneRevisionPollOutcome {
  /** This poll's stamp — the caller feeds it back as `previousStamp` next cycle. */
  readonly currentStamp: RemoteResource;
  /**
   * 18's amendment-review signal: the diff of two consecutive stamps.
   * `undefined` on the first poll (no previous stamp), NOT
   * `{material:false}` — "not yet comparable" and "compared, unchanged"
   * are different facts and are kept distinguishable on purpose.
   */
  readonly signal: MaterialChangeSignal | undefined;
  /**
   * String projection of the issue's field values at this poll — the
   * before/after snapshot 21's `buildJiraFieldDiffs`
   * (`@crabgic/gates`' `materiality-jira-adapter.ts`, whose
   * `JiraIssueFieldSnapshot` is exactly `Readonly<Record<string,string>>`)
   * consumes. The revision signal alone is NOT sufficient input for 21's
   * classifier — it says only "something moved", never which field — so
   * the poll carries the snapshot alongside it.
   *
   * Three rules, each load-bearing:
   * - `summary` is RE-ADDED, because `toJiraIssue`
   *   (`../resource-client/reads.ts`) destructures it OUT of
   *   `JiraIssue.fields`; without this a summary edit would be invisible to
   *   the classifier — the silent false-negative direction 21's own MAJOR-1
   *   fix was about.
   * - non-string values are `JSON.stringify`'d, so a remote edit inside a
   *   structured value (e.g. an ADF `description`) still surfaces as a diff
   *   rather than collapsing to `[object Object]` on both sides.
   * - `updated` is structurally ABSENT (destructured out upstream), so the
   *   revision timestamp itself can never masquerade as a tracked-field
   *   edit and spuriously trigger a halt.
   */
  readonly fieldSnapshot: Readonly<Record<string, string>>;
}

export interface MilestoneSyncInput {
  readonly issueKey: string;
  readonly kind: MilestoneEventKind;
  readonly outcome: string;
  readonly evidence: string;
  readonly risk: string;
  readonly next: string;
  readonly ref: string;
  readonly envelopeId: string;
  readonly policy?: CommunicationPolicy;
  readonly now?: () => Date;
  /** Opt-in: also poll the issue's remote revision on this milestone (see `MilestoneRevisionPollInput`). */
  readonly revisionPoll?: MilestoneRevisionPollInput;
}

export interface MilestoneSyncDeps {
  readonly resourceClient: JiraResourceClient;
  /** A `MarkerReconciler` scoped to `input.issueKey`'s comments (`../reconciliation/entity-property-marker.ts`'s `"comment"` kind). */
  readonly commentMarkerReconciler: MarkerReconciler;
}

/** This phase's own discretionary projection of a `JournalEntryType: "milestone_sync"` entry's payload (roadmap/18 §Interfaces produced) — the caller appends it via its own `JournalStore`; this connector holds no `@crabgic/journal` dependency of its own. */
export interface MilestoneSyncJournalEntryPayload {
  readonly issueKey: string;
  readonly milestoneKind: MilestoneEventKind;
  readonly marker: string;
  readonly commentAction: "create" | "update";
  readonly syncedAt: string;
}

/**
 * Both arms carry `revisionPoll` on purpose: a material remote amendment
 * matters MORE, not less, on a cycle whose comment 17's lint blocked — the
 * poll happened and its result must not be swallowed by the blocked arm.
 */
export type MilestoneSyncOutcome =
  | {
      readonly status: "planned";
      readonly commentAction: "create" | "update";
      readonly plan: ReturnType<JiraResourceClient["comments"]["planCreate"]>;
      readonly marker: string;
      readonly journalEntry: MilestoneSyncJournalEntryPayload;
      readonly revisionPoll?: MilestoneRevisionPollOutcome;
    }
  | {
      readonly status: "blocked";
      readonly error: "policy_blocked";
      readonly findings: readonly LintFinding[];
      readonly revisionPoll?: MilestoneRevisionPollOutcome;
    };

function milestoneMarker(issueKey: string, kind: MilestoneEventKind): string {
  return `milestone-sync:${issueKey}:${kind}`;
}

/**
 * Plans (never applies — this connector's own "planning is local-only"
 * rule) one milestone-sync comment write: renders through 17's regenerate-
 * once pipeline, converts to ADF, defense-in-depth-validates the ADF
 * safe subset, then either creates a fresh dedup-marked comment or edits
 * the existing one in place, found via `deps.commentMarkerReconciler`.
 */
export async function planMilestoneSync(
  input: MilestoneSyncInput,
  deps: MilestoneSyncDeps,
): Promise<MilestoneSyncOutcome> {
  const policy = input.policy ?? DEFAULT_COMMUNICATION_POLICY;
  const now = input.now ?? (() => new Date());
  const marker = milestoneMarker(input.issueKey, input.kind);

  // ORDERING DECISION, documented where the reader lands: the poll runs
  // FIRST, before render/lint, so that it is reported on EVERY path
  // including the two `policy_blocked` returns below. The opposite ordering
  // (poll only once a comment is plannable) would silently drop the
  // amendment signal for exactly the cycles where a human most needs it —
  // the ones 17's lint refused to comment on.
  let revisionPoll: MilestoneRevisionPollOutcome | undefined;
  if (input.revisionPoll !== undefined) {
    const issue = await deps.resourceClient.issues.get(input.issueKey);
    const currentStamp = stampJiraRemoteResource({
      externalConnectionId: input.revisionPoll.externalConnectionId,
      issueKey: input.issueKey,
      revision: issue.revision,
      observedAt: now().toISOString(),
    });
    // RESIDUAL, disclosed: when Jira omits `fields.updated`, `toJiraIssue`
    // stamps the literal `"unknown"`, so two such polls compare equal and
    // this signal reports non-material even if fields did change. The
    // `fieldSnapshot` channel is what still surfaces such an edit to 21's
    // classifier — which is the halt decision, so the guarantee survives.
    const signal =
      input.revisionPoll.previousStamp !== undefined
        ? compareRemoteResourceRevisions(input.revisionPoll.previousStamp, currentStamp)
        : undefined;
    const fieldSnapshot: Readonly<Record<string, string>> = {
      summary: issue.summary,
      ...Object.fromEntries(
        Object.entries(issue.fields).map(([id, value]) => [
          id,
          typeof value === "string" ? value : JSON.stringify(value),
        ]),
      ),
    };
    revisionPoll = { currentStamp, signal, fieldSnapshot };
  }
  const revisionPollOutcome = revisionPoll !== undefined ? { revisionPoll } : {};

  const renderOutcome = await renderWithRegeneration({
    kind: "jira_milestone_comment",
    policy,
    now,
    generate: () =>
      renderJiraMilestoneComment({
        outcome: input.outcome,
        evidence: input.evidence,
        risk: input.risk,
        next: input.next,
        ref: input.ref,
      }),
  });

  if (renderOutcome.status === "blocked") {
    return {
      status: "blocked",
      error: "policy_blocked",
      findings: renderOutcome.findings,
      ...revisionPollOutcome,
    };
  }

  const adf = toADF(renderOutcome.artifact.content);
  const adfFindings = validateAdfSafeSubset(adf);
  if (adfFindings.length > 0) {
    return {
      status: "blocked",
      error: "policy_blocked",
      findings: adfFindings,
      ...revisionPollOutcome,
    };
  }

  const existingCommentId = await deps.commentMarkerReconciler.findByMarker(marker);

  if (existingCommentId !== undefined) {
    const comments = await deps.resourceClient.comments.list(input.issueKey);
    const existing = comments.find((c) => c.id === existingCommentId);
    const plan = deps.resourceClient.comments.planUpdate(
      input.issueKey,
      existingCommentId,
      existing?.updatedRevision ?? "unknown",
      adf,
      input.envelopeId,
    );
    return {
      status: "planned",
      commentAction: "update",
      plan,
      marker,
      journalEntry: {
        issueKey: input.issueKey,
        milestoneKind: input.kind,
        marker,
        commentAction: "update",
        syncedAt: now().toISOString(),
      },
      ...revisionPollOutcome,
    };
  }

  const plan = deps.resourceClient.comments.planCreate(
    input.issueKey,
    adf,
    marker,
    input.envelopeId,
  );
  return {
    status: "planned",
    commentAction: "create",
    plan,
    marker,
    journalEntry: {
      issueKey: input.issueKey,
      milestoneKind: input.kind,
      marker,
      commentAction: "create",
      syncedAt: now().toISOString(),
    },
    ...revisionPollOutcome,
  };
}
