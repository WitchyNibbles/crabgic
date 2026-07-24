import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CURRENT_SCHEMA_VERSION,
  LearningProposalSchema,
  type LearningProposal,
  type LearningProposalState,
} from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
import { LEARNING_DIR_MODE, LEARNING_REGISTRY_SUBDIR } from "../store/layout.js";
import { atomicWriteFile, ensureDir, listJsonFiles, readJsonFile } from "../store/fs-utils.js";
import { learningProposalTransition } from "../state-machine.js";
import {
  DuplicateApprovalTokenError,
  InsufficientIndependentReviewError,
  ProposalNotFoundError,
} from "../errors.js";

/**
 * `VerifiedApprovalRecord` — the RESULT of a genuine, in-process
 * verification this package itself performed (via an injected
 * `LearningReviewTokenVerifier`, never trusted from a caller-supplied
 * claim by name — see ADVERSARIAL-VALIDATION FIX below). Never
 * constructed directly by a caller; only `recordReviewApproval` produces
 * one, after `verify()` has genuinely succeeded.
 */
export interface VerifiedApprovalRecord {
  readonly tokenId: string;
  readonly verifiedAt: string;
}

/**
 * Verifies a RAW approval-token string is genuinely minted, of the
 * `learning_review` subject kind, and BOUND to `proposal` (the
 * confused-deputy check — a token minted for a different proposal, or a
 * `contract.approve` token for an unrelated `ChangeSet`, must never
 * verify here, mirroring 11's own `contract.approve` C1 fix). Resolves to
 * the token's own `tokenId` on success; rejects (any typed error the
 * concrete verifier defines) otherwise — the rejection is never swallowed.
 *
 * INJECTED, never implemented by this package: `@eo/learning` holds no
 * signing secret and never verifies HMAC signatures itself — that would
 * create an unwanted `@eo/learning` -> `@eo/cli` dependency (the wrong
 * direction: `packages/cli` depends on this package, not the reverse).
 * `packages/cli`'s `learn approve` backend supplies the REAL verifier,
 * wrapping 11's own `verifyApprovalTokenDurable`
 * (`packages/cli/src/approval/durable-approval-ledger.ts`) with the
 * `"learning_review"` subject kind and a proposal-bound digest. This
 * package's own tests inject a faithful-but-decoupled reference
 * implementation (`../test-support/reference-token-verifier.ts`) that
 * reproduces the same properties (HMAC signature, subject kind, proposal
 * binding, single-use) without depending on `@eo/cli`.
 *
 * ADVERSARIAL-VALIDATION FIX (2026-07-24): the ORIGINAL design trusted a
 * caller-supplied `VerifiedApprovalRecord` object BY NAME — `transition`
 * accepted an arbitrary `reviewApprovals` array directly, and
 * `recordReviewApproval` accepted a pre-built `{tokenId, verifiedAt}`
 * with no verification at all. Two FABRICATED, merely-distinct strings
 * promoted a proposal with no minting, no CLI, no secret involved. This
 * type/function pair closes that hole: verification now happens INSIDE
 * `@eo/learning`, on the raw token, before anything is ever recorded or
 * promoted.
 */
export type LearningReviewTokenVerifier = (
  rawToken: string,
  proposal: LearningProposal,
) => Promise<{ readonly tokenId: string }>;

interface StoredProposalRecord {
  readonly proposal: LearningProposal;
  readonly reviewApprovals: readonly VerifiedApprovalRecord[];
  /**
   * The FORWARD `ChangeSet` id a promotion produced — package-internal
   * storage only (02's frozen `LearningProposal` schema carries
   * `rollbackChangeSetId` for the INVERSE ChangeSet, but has no field for
   * the forward one). Recorded by `../promotion/promote.ts` immediately
   * after a successful promotion so `../rollback/rollback.ts` can look it
   * up without requiring every caller to thread it through by hand.
   */
  readonly promotedChangeSetId?: string;
}

export interface CreateProposalInput {
  readonly content: string;
  readonly evidenceRecordIds?: readonly string[];
  readonly sourceWorkUnitId?: string;
}

export interface TransitionOptions {
  /** Additional `EvidenceRecord` ids to append at this transition (e.g. a dev/held-out grading run's own evidence). */
  readonly additionalEvidenceRecordIds?: readonly string[];
  /** Set only on a transition to `rolled_back` — the inverse `ChangeSet`'s id. */
  readonly rollbackChangeSetId?: string;
}

/**
 * The proposal store's canonical record — roadmap/22-learning-system.md
 * work item 1: "Proposal store + `LearningProposalState` machine +
 * journaled transitions." One JSON file per proposal under `registryDir`
 * (`../store/layout.ts`), atomically written; every state transition
 * (except construction of the initial `observation` record, which is not
 * itself a transition FROM anything) appends exactly one
 * `learning_transition` journal entry, correlated via the envelope's
 * `workUnitId` field carrying this proposal's own id — `02`'s
 * `LearningTransitionPayloadSchema` has no dedicated `proposalId` field of
 * its own (out of this package's authority to add one to a frozen 02
 * contract), so the existing optional cross-reference slot is reused,
 * matching this repo's own established convention of folding an
 * unmodeled correlation onto an available envelope field (e.g. `@eo/cli`'s
 * `approval_token_mint` `scope` string folding `subjectKind`+`digest`).
 *
 * SELF-PROMOTION GUARD (roadmap/22 §In scope, "Separation of duties," the
 * keystone invariant): `transition(id, "promoted")` is the ONE place a
 * proposal's state ever becomes `promoted`, and it reads ONLY this
 * proposal's own already-accumulated `reviewApprovals` — there is NO
 * parameter on `transition`/`TransitionOptions` through which a caller can
 * supply an approvals array directly; the sole way an approval ever
 * enters that accumulated list is `recordReviewApproval`, which requires
 * the INJECTED `LearningReviewTokenVerifier` to genuinely succeed against
 * a RAW token string (authenticity + `learning_review` subject kind +
 * this-proposal binding — see that type's own doc comment). `transition`
 * then requires >= 2 pairwise-DISTINCT `tokenId`s among those genuinely
 * verified approvals before calling into the state machine.
 *
 * ADVERSARIAL-VALIDATION FIX (2026-07-24): an earlier version of this
 * guard accepted a caller-supplied `reviewApprovals` array — of
 * `{tokenId, verifiedAt}` objects TRUSTED BY NAME, never independently
 * verified — directly on `TransitionOptions`, so two arbitrary, merely
 * string-distinct, never-minted tokens promoted a proposal with no
 * minting, no CLI, no secret, no MCP tool. That parameter no longer
 * exists on `TransitionOptions` at all (removed, not merely
 * deprecated) — calling this method directly (bypassing `packages/cli`'s
 * `learn approve` entirely — e.g. from inside a running work unit) can
 * only ever promote using approvals THIS registry itself already
 * verified, proven directly in `./self-promotion.test.ts`.
 */
export class ProposalRegistry {
  readonly #registryDir: string;
  readonly #journal: Pick<JournalStore, "appendEntry">;
  readonly #clock: () => string;

  constructor(options: {
    readonly registryDir: string;
    readonly journal: Pick<JournalStore, "appendEntry">;
    readonly clock?: () => string;
  }) {
    this.#registryDir = options.registryDir;
    this.#journal = options.journal;
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  async create(input: CreateProposalInput): Promise<LearningProposal> {
    await ensureDir(this.#registryDir, LEARNING_DIR_MODE);
    const proposal: LearningProposal = LearningProposalSchema.parse({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: randomUUID(),
      state: "observation",
      content: input.content,
      evidenceRecordIds: [...(input.evidenceRecordIds ?? [])],
      createdAt: this.#clock(),
      ...(input.sourceWorkUnitId !== undefined ? { sourceWorkUnitId: input.sourceWorkUnitId } : {}),
    } satisfies LearningProposal);

    await this.#persist({ proposal, reviewApprovals: [] });
    return proposal;
  }

  async get(id: string): Promise<LearningProposal | undefined> {
    const record = await this.#tryRead(id);
    return record?.proposal;
  }

  async getReviewApprovals(id: string): Promise<readonly VerifiedApprovalRecord[]> {
    const record = await this.#tryRead(id);
    if (record === undefined) throw new ProposalNotFoundError(id);
    return record.reviewApprovals;
  }

  /** The forward `ChangeSet` id a promotion produced, if any — see `StoredProposalRecord.promotedChangeSetId`'s own doc comment. */
  async getPromotedChangeSetId(id: string): Promise<string | undefined> {
    const record = await this.#tryRead(id);
    if (record === undefined) throw new ProposalNotFoundError(id);
    return record.promotedChangeSetId;
  }

  /** Records the forward `ChangeSet` id a promotion produced — called by `../promotion/promote.ts` immediately after `transition(id, "promoted", …)` succeeds. */
  async recordPromotedChangeSetId(id: string, changeSetId: string): Promise<void> {
    const record = await this.#tryRead(id);
    if (record === undefined) throw new ProposalNotFoundError(id);
    await this.#persist({ ...record, promotedChangeSetId: changeSetId });
  }

  async list(): Promise<readonly LearningProposal[]> {
    const files = await listJsonFiles(this.#registryDir);
    const records = await Promise.all(
      files.map((name) => readJsonFile<StoredProposalRecord>(join(this.#registryDir, name))),
    );
    return records.map((r) => r.proposal).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Verifies `rawToken` via the INJECTED `verify` function (authenticity +
   * `learning_review` subject kind + binding to THIS proposal — see
   * `LearningReviewTokenVerifier`'s own doc comment) and, ONLY on success,
   * accumulates the resulting `VerifiedApprovalRecord` against this
   * proposal — WITHOUT transitioning any state. A proposal may need
   * several separate `learn approve` invocations (each minting/verifying
   * its own fresh, single-use token via 11's mechanism) before the
   * two-distinct-token bar for `transition(id, "promoted")` is cleared.
   * If `verify` rejects (bad signature, wrong subject kind, wrong
   * proposal binding, expired, already consumed — whatever the concrete
   * verifier defines), that rejection propagates UNCHANGED and NOTHING is
   * recorded — there is no partial/best-effort accumulation.
   */
  async recordReviewApproval(
    id: string,
    rawToken: string,
    verify: LearningReviewTokenVerifier,
  ): Promise<{
    readonly proposal: LearningProposal;
    readonly reviewApprovals: readonly VerifiedApprovalRecord[];
  }> {
    const record = await this.#tryRead(id);
    if (record === undefined) throw new ProposalNotFoundError(id);

    // Verification happens BEFORE anything is ever persisted — a failed
    // verification (thrown by `verify`) leaves this proposal's recorded
    // approvals completely untouched.
    const { tokenId } = await verify(rawToken, record.proposal);

    const approval: VerifiedApprovalRecord = { tokenId, verifiedAt: this.#clock() };
    const reviewApprovals = [...record.reviewApprovals, approval];
    await this.#persist({ proposal: record.proposal, reviewApprovals });
    return { proposal: record.proposal, reviewApprovals };
  }

  /**
   * Advances a proposal's state. Throws `IllegalTransitionError` (via
   * `learningProposalTransition`) for any edge the table doesn't declare —
   * including a `to: "promoted"` attempt from any state other than
   * `independent_review`. When `to === "promoted"`, additionally requires
   * >= 2 pairwise-distinct, already-verified review approvals — this
   * proposal's OWN `record.reviewApprovals`, accumulated exclusively via
   * `recordReviewApproval`'s genuine verification (see class-level doc
   * comment); there is no parameter here through which a caller can
   * supply a different approvals array. Checked BEFORE the state machine
   * call, so an insufficiently-reviewed promotion attempt against a
   * proposal genuinely IN `independent_review` still fails closed with
   * the more specific error.
   */
  async transition(
    id: string,
    to: LearningProposalState,
    options: TransitionOptions = {},
  ): Promise<LearningProposal> {
    const record = await this.#tryRead(id);
    if (record === undefined) throw new ProposalNotFoundError(id);
    const from = record.proposal.state;

    // Throws IllegalTransitionError if `from -> to` is not a declared edge —
    // this is what makes `observation -> promoted` (or any other skip)
    // fail regardless of how many approvals are supplied, and it is
    // checked BEFORE the approval-count guard so an out-of-sequence
    // promotion attempt reports the more fundamental defect first.
    learningProposalTransition(from, to);

    if (to === "promoted") {
      assertSufficientDistinctApprovals(id, record.reviewApprovals);
    }

    const updatedProposal: LearningProposal = {
      ...record.proposal,
      state: to,
      evidenceRecordIds: [
        ...record.proposal.evidenceRecordIds,
        ...(options.additionalEvidenceRecordIds ?? []),
      ],
      ...(options.rollbackChangeSetId !== undefined
        ? { rollbackChangeSetId: options.rollbackChangeSetId }
        : {}),
    };
    const validated = LearningProposalSchema.parse(updatedProposal);

    await this.#persist({ proposal: validated, reviewApprovals: record.reviewApprovals });
    await this.#journal.appendEntry({
      type: "learning_transition",
      workUnitId: id,
      payload: { from, to },
    });

    return validated;
  }

  async #tryRead(id: string): Promise<StoredProposalRecord | undefined> {
    try {
      return await readJsonFile<StoredProposalRecord>(this.#recordPath(id));
    } catch {
      return undefined;
    }
  }

  async #persist(record: StoredProposalRecord): Promise<void> {
    await ensureDir(this.#registryDir, LEARNING_DIR_MODE);
    await atomicWriteFile(this.#recordPath(record.proposal.id), JSON.stringify(record), 0o600);
  }

  #recordPath(id: string): string {
    return join(this.#registryDir, `${id}.json`);
  }
}

function assertSufficientDistinctApprovals(
  proposalId: string,
  approvals: readonly VerifiedApprovalRecord[],
): void {
  if (approvals.length < 2) {
    throw new InsufficientIndependentReviewError(proposalId, approvals.length);
  }
  const seen = new Set<string>();
  for (const approval of approvals) {
    if (seen.has(approval.tokenId)) {
      throw new DuplicateApprovalTokenError(proposalId, approval.tokenId);
    }
    seen.add(approval.tokenId);
  }
}

export { LEARNING_REGISTRY_SUBDIR };
