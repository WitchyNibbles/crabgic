import { z } from "zod";
import { IdSchema, NonEmptyStringSchema } from "../shared/ids.js";
import { canonicalHash } from "../shared/canonical-hash.js";
import type { Requirement } from "./requirement.js";

/**
 * Acceptance-criteria seal — roadmap/24-sealed-acceptance-criteria.md.
 *
 * The problem this closes: an implementer that can edit the criteria it is
 * judged against makes "done" meaningless. Before this, `Requirement` records
 * were not persisted at all, the `AuthorizationEnvelope` content hash covers
 * authority fields only (never criteria) — amended 2026-08-06, interface-ledger
 * Gap 22: that hash now also covers the derived provisional performance-budget
 * hash (`./authorization-envelope.ts`'s `provisionalBudgetHash`), so the token
 * signs authority fields PLUS that budget binding; still never criteria, which
 * is what this seal exists for — the approval token signs that envelope hash,
 * and `Requirement.id` is derived from `section` + `title` —
 * so editing criteria changed no id, no hash, and no signature anywhere.
 *
 * The shape is deliberately the same one roadmap/15 already arrived at for
 * performance budgets (`packages/perf/src/contract/hash-link.ts`), including
 * the reason it arrived there: a SELF-checksum alone was a MAJOR finding,
 * because the record's content and its own hash field are equally mutable, so
 * a tamper that recomputes the hash consistently passes. Evidence has to be
 * bound to something the tamperer cannot rewrite — for budgets that is the
 * append-only hash-chained journal, and it is the same anchor here.
 *
 * This module is PURE: it compares a stored requirement against an already-
 * resolved approval seal and never reads the journal itself. Resolving the
 * seal from the journal belongs to the enforcement layer (roadmap/24 work
 * items 4-6), which is also what keeps `@crabgic/contracts` free of a
 * dependency on `@crabgic/journal` — the dependency runs the other way.
 */

/**
 * Why `verifyCriteriaSeal` reports `ok: false`. Canonical vocabulary owned
 * here and consumed by the enforcement layer, following the
 * `PERFORMANCE_OUTCOMES` precedent (`./performance-contract.ts`): the words a
 * gate reports are contracts, not an enum re-invented at each check site.
 */
export const CRITERIA_SEAL_FAILURE_REASONS = [
  "self_consistency_mismatch",
  "no_approval_seal",
  "approval_seal_mismatch",
] as const;
export const CriteriaSealFailureReasonSchema = z.enum(CRITERIA_SEAL_FAILURE_REASONS);
export type CriteriaSealFailureReason = z.infer<typeof CriteriaSealFailureReasonSchema>;

/**
 * The seal recorded at approval time: every requirement of one ChangeSet
 * mapped to the canonical hash of the criteria that were approved.
 *
 * The whole set is recorded rather than one entry per requirement so that a
 * requirement DROPPED between approval and completion is as visible as one
 * edited — a per-requirement record could be silently omitted.
 */
export const CriteriaApprovalSealSchema = z
  .object({
    changeSetId: IdSchema,
    criteriaHashes: z.record(IdSchema, NonEmptyStringSchema),
  })
  .strict();
export type CriteriaApprovalSeal = z.infer<typeof CriteriaApprovalSealSchema>;

export interface CriteriaSealCheckResult {
  readonly ok: boolean;
  /** The hash recomputed from the record's CURRENT criteria — reported so a caller can journal what it actually saw. */
  readonly recomputedHash: string;
  readonly reason?: CriteriaSealFailureReason;
}

/**
 * The canonical hash of an ordered acceptance-criteria list. Order is
 * significant: reordering criteria changes the digest, because
 * `canonicalStringify` never reorders arrays.
 */
export function computeCriteriaHash(acceptanceCriteria: readonly string[]): string {
  return canonicalHash([...acceptanceCriteria]);
}

/**
 * Checks run in order, first failure wins:
 *
 *   1. `self_consistency_mismatch` — the record's criteria do not even hash
 *      to its own `criteriaHash` field (the naive "edited the text, left the
 *      hash stale" vector). Cheap, and needs no seal at all.
 *   2. `no_approval_seal` — no approval seal covers this requirement.
 *      FAIL-CLOSED, never "no seal means trust the record": either the
 *      ChangeSet never went through the approval path, or the requirement was
 *      introduced after approval.
 *   3. `approval_seal_mismatch` — a seal exists and disagrees. This is the
 *      real catch: a post-approval edit that ALSO recomputes `criteriaHash`
 *      consistently is self-consistent, and still cannot match what was
 *      chained into the journal at approval time.
 */
export function verifyCriteriaSeal(
  requirement: Requirement,
  approvalSeal: CriteriaApprovalSeal | undefined,
): CriteriaSealCheckResult {
  const recomputedHash = computeCriteriaHash(requirement.acceptanceCriteria);
  if (recomputedHash !== requirement.criteriaHash) {
    return { ok: false, recomputedHash, reason: "self_consistency_mismatch" };
  }

  const approvedHash = approvalSeal?.criteriaHashes[requirement.id];
  if (approvedHash === undefined) {
    return { ok: false, recomputedHash, reason: "no_approval_seal" };
  }

  if (approvedHash !== requirement.criteriaHash) {
    return { ok: false, recomputedHash, reason: "approval_seal_mismatch" };
  }

  return { ok: true, recomputedHash };
}

/** Typed refusal carrying the reason, so an enforcement site can journal an accurate detail rather than a boolean. */
export class CriteriaSealMismatchError extends Error {
  readonly reason: CriteriaSealFailureReason;
  readonly requirementId: string;
  readonly recomputedHash: string;

  constructor(requirementId: string, result: CriteriaSealCheckResult) {
    super(
      `contracts: acceptance-criteria seal verification failed for requirement ${requirementId} (${result.reason ?? "unknown"})`,
    );
    this.name = "CriteriaSealMismatchError";
    this.reason = result.reason ?? "self_consistency_mismatch";
    this.requirementId = requirementId;
    this.recomputedHash = result.recomputedHash;
  }
}

/**
 * The missing-seal case as a subclass, mirroring
 * `BudgetJournalAnchorMissingError extends BudgetHashLinkMismatchError`: a
 * caller that wants to distinguish "never approved" from "approved and
 * edited" can, and one that only cares that verification failed still
 * catches the base.
 */
export class CriteriaApprovalSealMissingError extends CriteriaSealMismatchError {
  constructor(requirementId: string, result: CriteriaSealCheckResult) {
    super(requirementId, result);
    this.name = "CriteriaApprovalSealMissingError";
  }
}

/** `verifyCriteriaSeal` as a fail-closed assertion — throws the typed error, returns silently when intact. */
export function assertCriteriaSealIntact(
  requirement: Requirement,
  approvalSeal: CriteriaApprovalSeal | undefined,
): void {
  const result = verifyCriteriaSeal(requirement, approvalSeal);
  if (result.ok) return;
  if (result.reason === "no_approval_seal") {
    throw new CriteriaApprovalSealMissingError(requirement.id, result);
  }
  throw new CriteriaSealMismatchError(requirement.id, result);
}
