import { DEFAULT_COMMUNICATION_POLICY, type CommunicationPolicy } from "@eo/contracts";
import type { MarkerReconciler } from "@eo/gateway";
import {
  renderJiraMilestoneComment,
  renderWithRegeneration,
  toADF,
  validateAdfSafeSubset,
  type LintFinding,
} from "@eo/renderer";
import type { JiraResourceClient } from "../resource-client/types.js";

/**
 * Milestone-sync engine — roadmap/18 §In scope: "Milestone-only updates
 * (start / material blocker / verified completion) via 17's Jira
 * milestone-comment template; status-comment dedup by entity-property
 * marker (edit in place, never a second comment)." §Exit criteria:
 * "Milestone sync yields ≤1 status comment per milestone, edited in
 * place."
 *
 * One marker PER (issueKey, milestone kind) — a "start" sync and a
 * "verified_completion" sync for the SAME issue are different milestones
 * and get their own comment/marker; a SECOND "start" sync (e.g. a re-run)
 * edits the first "start" comment in place, never creates a second one.
 */
export const MILESTONE_EVENT_KINDS = ["start", "material_blocker", "verified_completion"] as const;
export type MilestoneEventKind = (typeof MILESTONE_EVENT_KINDS)[number];

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
}

export interface MilestoneSyncDeps {
  readonly resourceClient: JiraResourceClient;
  /** A `MarkerReconciler` scoped to `input.issueKey`'s comments (`../reconciliation/entity-property-marker.ts`'s `"comment"` kind). */
  readonly commentMarkerReconciler: MarkerReconciler;
}

/** This phase's own discretionary projection of a `JournalEntryType: "milestone_sync"` entry's payload (roadmap/18 §Interfaces produced) — the caller appends it via its own `JournalStore`; this connector holds no `@eo/journal` dependency of its own. */
export interface MilestoneSyncJournalEntryPayload {
  readonly issueKey: string;
  readonly milestoneKind: MilestoneEventKind;
  readonly marker: string;
  readonly commentAction: "create" | "update";
  readonly syncedAt: string;
}

export type MilestoneSyncOutcome =
  | {
      readonly status: "planned";
      readonly commentAction: "create" | "update";
      readonly plan: ReturnType<JiraResourceClient["comments"]["planCreate"]>;
      readonly marker: string;
      readonly journalEntry: MilestoneSyncJournalEntryPayload;
    }
  | {
      readonly status: "blocked";
      readonly error: "policy_blocked";
      readonly findings: readonly LintFinding[];
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
    return { status: "blocked", error: "policy_blocked", findings: renderOutcome.findings };
  }

  const adf = toADF(renderOutcome.artifact.content);
  const adfFindings = validateAdfSafeSubset(adf);
  if (adfFindings.length > 0) {
    return { status: "blocked", error: "policy_blocked", findings: adfFindings };
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
  };
}
