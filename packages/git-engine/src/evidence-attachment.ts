/**
 * Evidence-attachment routine — roadmap/08-integration-publication.md
 * work item 5: "Evidence-attachment routine for `pr_title`/`pr_body`/
 * `review_comment` → `EvidenceRecord` + `evidence_pointer` journal entries.
 * Failing-first: a fixture `ChangeSet` must yield exactly zero attached
 * `EvidenceRecord`s before the routine exists, then exactly three (one per
 * `ArtifactKind`) after, each referencing a distinct lint-passed
 * `RenderedArtifact`." §In scope (Gap 6): "`pr_title`/`pr_body`/
 * `review_comment` candidates assembled from the ChangeSet's
 * `Requirement`/`EvidenceRecord` summaries ... each lint-passed
 * `RenderedArtifact` is wrapped in an `EvidenceRecord` (02) and journaled as
 * an `evidence_pointer` entry (`JournalEntryType`, 02) against the
 * `ChangeSet` — no delivery, no VCS-host call, ever."
 *
 * TEMPLATES REUSED, NOT REIMPLEMENTED: `renderPrTitle`/`renderPrBody`/
 * `renderReviewComment` are 17's own template functions (roadmap/17
 * §Templates) — this module supplies only the structured
 * `EvidenceAttachmentSource` data, never free-text authorship.
 *
 * IDEMPOTENCY (roadmap §Test plan, Security bullet): "idempotent re-run of
 * the evidence-attachment routine for an already-published `ChangeSet` must
 * not duplicate `EvidenceRecord`s (04's idempotency-key mechanism,
 * transitively available via 07)." Each of the 3 kinds is individually
 * keyed through `@eo/journal`'s `IdempotencyRegistry.checkOrRecord` — the
 * `evidence_pointer` journal append happens ONLY inside the `compute()`
 * closure, which `IdempotencyRegistry` only ever invokes on a genuine
 * first-time write; a replayed call returns the SAME previously-recorded
 * `EvidenceRecord` without appending a second journal entry.
 *
 * 2026-07-24 adversarial-validation fix, LOW-MEDIUM finding (confirmed
 * over-broad idempotency key) — TWO changes, both required together:
 *
 *  1. IDEMPOTENCY-KEY SCOPING: `contentHash` was originally
 *     `sha256(JSON.stringify({ kind, source }))` — hashing the ENTIRE
 *     `EvidenceAttachmentSource` for EVERY kind, even though each kind's
 *     template only consumes a SUBSET of its fields (`pr_title`:
 *     `type`/`scope`/`outcome`; `pr_body`: `outcome`/`validation`/`risk`/
 *     `tracking`; `review_comment`: `finding`/`evidence`/`action`). An
 *     operator fixing ONE blocked kind's own field (e.g. `finding`,
 *     consumed only by `review_comment`) therefore changed the content
 *     hash for `pr_title`/`pr_body` TOO, even though neither field they
 *     actually consume changed. `contentHash` is now derived from
 *     `scopedFieldsFor(kind, source)` — only the fields THAT kind's own
 *     template consumes — via the SAME projection `generatorFor` itself
 *     renders from, so the two can never drift out of sync.
 *
 *  2. RENDER-BEFORE-RECORD ORDERING (the second half — scoping alone is
 *     NOT sufficient for the kind an operator actually fixes): a BLOCKED
 *     render is now NEVER passed to `IdempotencyRegistry.checkOrRecord` at
 *     all — `renderWithRegeneration` runs FIRST, outside any idempotency
 *     wrapper; only a render that actually SUCCEEDS is handed to
 *     `checkOrRecord` (stable `operationId = evidence-attachment:
 *     <changeSetId>:<kind>`, scoped `contentHash`). A kind that renders
 *     blocked therefore never touches `IdempotencyRegistry`'s own
 *     conflict-detection at all — it is recomputed fresh on every call
 *     (harmless: a blocked render has no side effects to duplicate), so a
 *     content fix on retry simply succeeds with no conflict machinery
 *     involved. Once a kind's render DOES succeed, it becomes durably
 *     idempotency-protected exactly as before: the SAME content on a
 *     later call replays the SAME `EvidenceRecord` (no duplicate), and a
 *     DIFFERENT content on a later call for that ALREADY-successful kind
 *     still throws `EvidenceAttachmentConflictError` (unchanged, still
 *     tested) — real, already-attached evidence stays protected from
 *     silent drift; only the not-yet-successful path is freely retriable.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_COMMUNICATION_POLICY,
  EvidenceRecordSchema,
  type CommunicationPolicy,
  type EvidenceRecord,
} from "@eo/contracts";
import type { ArtifactKind, LintFinding } from "@eo/renderer";
import {
  renderPrBody,
  renderPrTitle,
  renderReviewComment,
  renderWithRegeneration,
} from "@eo/renderer";
import type { IdempotencyRegistry } from "@eo/journal";
import {
  buildEvidencePointerEntryInput,
  type IntegrationJournalAppender,
} from "./integration-journal.js";

/** Every field this phase's `pr_title`/`pr_body`/`review_comment` templates need, sourced from the owning `ChangeSet`'s `Requirement`/`EvidenceRecord` summaries — never freshly authored prose. */
export interface EvidenceAttachmentSource {
  readonly type: string;
  readonly scope?: string;
  readonly outcome: string;
  readonly validation: string;
  readonly risk: string;
  readonly tracking: string;
  readonly finding: string;
  readonly evidence: string;
  readonly action: string;
}

export interface AttachEvidenceOptions {
  readonly changeSetId: string;
  readonly source: EvidenceAttachmentSource;
  /** The exact Git object id this evidence is captured against (`EvidenceRecord.objectId`). */
  readonly objectId: string;
  readonly journal: IntegrationJournalAppender;
  readonly idempotency: IdempotencyRegistry;
  readonly policy?: CommunicationPolicy;
  /** Injectable for deterministic testing; defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

export type EvidenceAttachmentOutcome =
  | {
      readonly status: "attached";
      readonly kind: ArtifactKind;
      readonly evidenceRecord: EvidenceRecord;
    }
  | {
      readonly status: "blocked";
      readonly kind: ArtifactKind;
      readonly findings: readonly LintFinding[];
    };

export interface AttachEvidenceResult {
  readonly outcomes: readonly EvidenceAttachmentOutcome[];
}

const TOOLCHAIN_FINGERPRINT = "@eo/git-engine evidence-attachment";

const EVIDENCE_ARTIFACT_KINDS = ["pr_title", "pr_body", "review_comment"] as const;
type EvidenceArtifactKind = (typeof EVIDENCE_ARTIFACT_KINDS)[number];

/** Thrown when a re-run supplies DIFFERENT source content for a `(changeSetId, kind)` pair that already rendered SUCCESSFULLY before — a genuine caller bug (already-attached evidence content silently diverging), never silently resolved by overwriting. Never thrown for a kind that was merely previously BLOCKED — see file-level doc comment's "RENDER-BEFORE-RECORD ORDERING" section. */
export class EvidenceAttachmentConflictError extends Error {
  constructor(operationId: string) {
    super(
      `evidence-attachment: "${operationId}" was already attached with DIFFERENT source content — refusing to silently overwrite`,
    );
    this.name = "EvidenceAttachmentConflictError";
  }
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Fields `pr_title`'s template actually consumes. */
interface PrTitleFields {
  readonly type: string;
  readonly scope?: string;
  readonly outcome: string;
}

/** Fields `pr_body`'s template actually consumes. */
interface PrBodyFields {
  readonly outcome: string;
  readonly validation: string;
  readonly risk: string;
  readonly tracking: string;
}

/** Fields `review_comment`'s template actually consumes. */
interface ReviewCommentFields {
  readonly finding: string;
  readonly evidence: string;
  readonly action: string;
}

type ScopedFields = PrTitleFields | PrBodyFields | ReviewCommentFields;

/**
 * Projects `source` down to EXACTLY the fields `kind`'s own template reads
 * — the single source of truth both `generatorFor` (rendering) and this
 * module's idempotency-key derivation (`contentHash`) build on, so the two
 * can never drift out of sync with each other (see file-level doc comment,
 * finding 1, "IDEMPOTENCY-KEY SCOPING").
 */
function scopedFieldsFor(
  kind: EvidenceArtifactKind,
  source: EvidenceAttachmentSource,
): ScopedFields {
  switch (kind) {
    case "pr_title":
      return {
        type: source.type,
        ...(source.scope !== undefined ? { scope: source.scope } : {}),
        outcome: source.outcome,
      } satisfies PrTitleFields;
    case "pr_body":
      return {
        outcome: source.outcome,
        validation: source.validation,
        risk: source.risk,
        tracking: source.tracking,
      } satisfies PrBodyFields;
    case "review_comment":
      return {
        finding: source.finding,
        evidence: source.evidence,
        action: source.action,
      } satisfies ReviewCommentFields;
  }
}

function generatorFor(kind: EvidenceArtifactKind, fields: ScopedFields): () => string {
  switch (kind) {
    case "pr_title":
      return () => renderPrTitle(fields as PrTitleFields);
    case "pr_body":
      return () => renderPrBody(fields as PrBodyFields);
    case "review_comment":
      return () => renderReviewComment(fields as ReviewCommentFields);
  }
}

async function attachOne(
  kind: EvidenceArtifactKind,
  options: AttachEvidenceOptions,
  policy: CommunicationPolicy,
  now: () => Date,
): Promise<EvidenceAttachmentOutcome> {
  const scopedFields = scopedFieldsFor(kind, options.source);

  // Render FIRST, entirely outside any idempotency wrapper — see file-level
  // doc comment, finding 2, "RENDER-BEFORE-RECORD ORDERING". A blocked
  // render is returned immediately, never touching `IdempotencyRegistry` —
  // it has no side effects to protect or duplicate, so it is always safe
  // to recompute fresh on every call (exactly what lets a fixed retry
  // succeed with no conflict).
  const renderOutcome = await renderWithRegeneration({
    kind,
    policy,
    generate: generatorFor(kind, scopedFields),
    now,
  });

  if (renderOutcome.status === "blocked") {
    return { status: "blocked", kind, findings: renderOutcome.findings };
  }

  // Only a genuinely SUCCESSFUL render is handed to the idempotency
  // registry — this is where duplication protection actually matters.
  const contentHash = sha256Hex(JSON.stringify({ kind, fields: scopedFields }));
  const operationId = `evidence-attachment:${options.changeSetId}:${kind}`;

  const idempotencyOutcome = await options.idempotency.checkOrRecord(
    operationId,
    contentHash,
    async () => {
      const evidenceRecord: EvidenceRecord = EvidenceRecordSchema.parse({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: randomUUID(),
        changeSetId: options.changeSetId,
        command: `renderWithRegeneration:${kind}`,
        exitStatus: 0,
        toolchainFingerprint: TOOLCHAIN_FINGERPRINT,
        capturedAt: now().toISOString(),
        artifactDigests: [sha256Hex(renderOutcome.artifact.content)],
        objectId: options.objectId,
      });

      await options.journal.appendEntry(
        buildEvidencePointerEntryInput(evidenceRecord, options.changeSetId),
      );

      return { status: "attached", kind, evidenceRecord } satisfies EvidenceAttachmentOutcome;
    },
  );

  if (idempotencyOutcome.status === "conflict") {
    throw new EvidenceAttachmentConflictError(operationId);
  }
  return idempotencyOutcome.result as EvidenceAttachmentOutcome;
}

/**
 * Renders and attaches all 3 evidence artifacts (`pr_title`/`pr_body`/
 * `review_comment`) for one `ChangeSet`. Idempotent per-kind (see file-level
 * doc comment) — re-invoking with the identical `source` for an
 * already-attached `changeSetId` returns the SAME 3 outcomes without
 * duplicating any `EvidenceRecord`/journal entry; re-invoking after fixing
 * a previously-BLOCKED kind's own fields retries exactly that kind, without
 * disturbing any already-attached kind.
 */
export async function attachEvidence(
  options: AttachEvidenceOptions,
): Promise<AttachEvidenceResult> {
  const policy = options.policy ?? DEFAULT_COMMUNICATION_POLICY;
  const now = options.now ?? (() => new Date());

  const outcomes: EvidenceAttachmentOutcome[] = [];
  for (const kind of EVIDENCE_ARTIFACT_KINDS) {
    outcomes.push(await attachOne(kind, options, policy, now));
  }
  return { outcomes };
}
