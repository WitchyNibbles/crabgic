import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { IllegalTransitionError } from "@eo/contracts";
import { InsufficientIndependentReviewError } from "../errors.js";
import { ProposalRegistry } from "../proposal-store/registry.js";
import { promoteProposal } from "../promotion/promote.js";
import {
  createReferenceTokenVerifier,
  fabricateToken,
  mintReferenceToken,
  ReferenceTokenError,
} from "../test-support/reference-token-verifier.js";

/**
 * `@learning-redteam` — roadmap/22-learning-system.md §Exit criteria:
 * "Active run provably cannot promote its own policy: a test attempting
 * direct promotion-logic invocation from within a running work unit
 * fails." §Test plan, Security: "self-promotion attempt (active run calls
 * promotion logic directly, no CLI/token) must fail."
 *
 * ADVERSARIAL-VALIDATION FIX (2026-07-24): the ORIGINAL version of this
 * suite was vacuous on its own flagship case — it only tested 0/1/duplicate
 * approvals, whose two-distinct case actually failed on
 * `IllegalTransitionError` at `observation` (never reaching a proposal
 * genuinely at `independent_review` with two DISTINCT tokens at all), so it
 * would have passed identically whether or not two ARBITRARY,
 * never-minted strings could promote a proposal. They could: the
 * pre-fix guard only checked `tokenId` STRING distinctness, never
 * authenticity (was this genuinely minted?), subject kind, or binding to
 * THIS proposal. The fix moves verification into
 * `ProposalRegistry.recordReviewApproval` via an INJECTED verifier
 * function (`LearningReviewTokenVerifier` — this package still holds no
 * signing secret, preserving the `@eo/cli` -> `@eo/learning` dependency
 * direction) and REMOVES `transition`'s old `reviewApprovals` escape
 * hatch entirely — promotion now reads ONLY the already-verified,
 * accumulated approvals, never a caller-supplied array trusted by name.
 *
 * This suite calls `ProposalRegistry.recordReviewApproval`/`transition`/
 * `promoteProposal` DIRECTLY — the exact same functions a running work
 * unit would have to call if it tried to bypass `packages/cli`'s `learn
 * approve` entirely. No MCP tool, no CLI, no supervisor round-trip
 * anywhere in this file.
 */
const refs = {
  intentContractId: "11111111-1111-4111-8111-111111111111",
  authorizationEnvelopeId: "22222222-2222-4222-8222-222222222222",
  capabilityManifestId: "33333333-3333-4333-8333-333333333333",
  provisionalPerformanceContractId: "44444444-4444-4444-8444-444444444444",
};

let root: string;
let journal: JournalStore;
let registry: ProposalRegistry;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-learning-self-promotion-"));
  journal = createJournalStore({ journalDir: join(root, "journal") });
  registry = new ProposalRegistry({ registryDir: join(root, "registry"), journal });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function advanceToIndependentReview(proposalId: string): Promise<void> {
  await registry.transition(proposalId, "reproducer");
  await registry.transition(proposalId, "candidate");
  await registry.transition(proposalId, "dev_eval");
  await registry.transition(proposalId, "held_out_eval");
  await registry.transition(proposalId, "shadow_run");
  await registry.transition(proposalId, "independent_review");
}

describe("@learning-redteam self-promotion — an active run cannot promote its own policy", () => {
  it("a fresh observation-stage proposal cannot be promoted directly, at all, no matter the (real) approvals supplied", async () => {
    const secretKey = randomBytes(32);
    const proposal = await registry.create({ content: "self-serving lesson" });
    const verify = createReferenceTokenVerifier(secretKey);
    const tokenA = mintReferenceToken(secretKey, { proposalId: proposal.id });
    const tokenB = mintReferenceToken(secretKey, { proposalId: proposal.id });
    await registry.recordReviewApproval(proposal.id, tokenA, verify);
    await registry.recordReviewApproval(proposal.id, tokenB, verify);

    await expect(registry.transition(proposal.id, "promoted")).rejects.toThrow(
      IllegalTransitionError,
    );
  });

  it("a proposal that reached independent_review cannot be promoted with ZERO approvals (the proposer's own silent 'confirmation' never counts)", async () => {
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);

    await expect(
      promoteProposal({ registry, proposalId: proposal.id, changeSetRefs: refs }),
    ).rejects.toThrow(InsufficientIndependentReviewError);

    expect((await registry.get(proposal.id))?.state).toBe("independent_review");
  });

  it("THE FLAGSHIP CASE (previously vacuous): a proposal genuinely AT independent_review, 'approved' with two FABRICATED (never-minted) distinct token strings, is REJECTED — fabrication no longer promotes", async () => {
    const secretKey = randomBytes(32);
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);
    const verify = createReferenceTokenVerifier(secretKey);

    // Two DISTINCT fabricated strings — exactly the shape the pre-fix
    // guard accepted (distinct tokenId strings, never checked for
    // authenticity). Each must independently fail verification.
    await expect(
      registry.recordReviewApproval(proposal.id, fabricateToken(), verify),
    ).rejects.toThrow(ReferenceTokenError);
    await expect(
      registry.recordReviewApproval(proposal.id, fabricateToken(), verify),
    ).rejects.toThrow(ReferenceTokenError);

    // No approval was ever accumulated (both attempts threw before
    // anything was recorded) — promotion still refuses.
    expect(await registry.getReviewApprovals(proposal.id)).toEqual([]);
    await expect(
      promoteProposal({ registry, proposalId: proposal.id, changeSetRefs: refs }),
    ).rejects.toThrow(InsufficientIndependentReviewError);
    expect((await registry.get(proposal.id))?.state).toBe("independent_review");
  });

  it("a token genuinely minted for a DIFFERENT proposal cannot promote THIS one (confused-deputy guard)", async () => {
    const secretKey = randomBytes(32);
    const proposalA = await registry.create({ content: "lesson A" });
    const proposalB = await registry.create({ content: "lesson B" });
    await advanceToIndependentReview(proposalA.id);
    await advanceToIndependentReview(proposalB.id);
    const verify = createReferenceTokenVerifier(secretKey);

    // Genuinely minted, correctly signed — but bound to proposal A.
    const tokenForA = mintReferenceToken(secretKey, { proposalId: proposalA.id });

    await expect(registry.recordReviewApproval(proposalB.id, tokenForA, verify)).rejects.toThrow(
      /confused-deputy/,
    );
    expect(await registry.getReviewApprovals(proposalB.id)).toEqual([]);
  });

  it("a token genuinely minted for the WRONG subject kind cannot count toward independent review", async () => {
    const secretKey = randomBytes(32);
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);
    const verify = createReferenceTokenVerifier(secretKey);

    const wrongSubjectToken = mintReferenceToken(secretKey, {
      proposalId: proposal.id,
      subjectKind: "capability_digest",
    });

    await expect(
      registry.recordReviewApproval(proposal.id, wrongSubjectToken, verify),
    ).rejects.toThrow(/subject kind/);
  });

  it("the SAME genuinely-minted token replayed twice never counts as two distinct approvals", async () => {
    const secretKey = randomBytes(32);
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);
    const verify = createReferenceTokenVerifier(secretKey);
    const token = mintReferenceToken(secretKey, { proposalId: proposal.id });

    await registry.recordReviewApproval(proposal.id, token, verify);
    await expect(registry.recordReviewApproval(proposal.id, token, verify)).rejects.toThrow(
      /already consumed/,
    );

    expect(await registry.getReviewApprovals(proposal.id)).toHaveLength(1);
    await expect(
      promoteProposal({ registry, proposalId: proposal.id, changeSetRefs: refs }),
    ).rejects.toThrow(InsufficientIndependentReviewError);
  });

  it("two GENUINELY minted, correctly-subject-kinded, this-proposal-bound, distinct tokens DO promote — the real path still works", async () => {
    const secretKey = randomBytes(32);
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);
    const verify = createReferenceTokenVerifier(secretKey);

    await registry.recordReviewApproval(
      proposal.id,
      mintReferenceToken(secretKey, { proposalId: proposal.id }),
      verify,
    );
    await registry.recordReviewApproval(
      proposal.id,
      mintReferenceToken(secretKey, { proposalId: proposal.id }),
      verify,
    );

    const result = await promoteProposal({
      registry,
      proposalId: proposal.id,
      changeSetRefs: refs,
    });
    expect(result.proposal.state).toBe("promoted");
  });

  it("no sequence of direct calls, of any length, ever reaches 'promoted' without genuinely 2 distinct, this-proposal-bound, correctly-subject-kinded approvals — property over a fixed attack matrix", async () => {
    const attacks: ReadonlyArray<{
      readonly name: string;
      readonly build: (secretKey: Buffer, proposalId: string) => readonly string[];
    }> = [
      { name: "zero tokens", build: () => [] },
      {
        name: "one fabricated token",
        build: () => [fabricateToken()],
      },
      {
        name: "two fabricated tokens",
        build: () => [fabricateToken(), fabricateToken()],
      },
      {
        name: "one genuine + one fabricated",
        build: (secretKey, proposalId) => [
          mintReferenceToken(secretKey, { proposalId }),
          fabricateToken(),
        ],
      },
      {
        name: "two genuine tokens for a DIFFERENT proposal",
        build: (secretKey) => [
          mintReferenceToken(secretKey, { proposalId: "00000000-0000-4000-8000-000000000000" }),
          mintReferenceToken(secretKey, { proposalId: "00000000-0000-4000-8000-000000000000" }),
        ],
      },
      {
        name: "two genuine, correctly-bound tokens of the WRONG subject kind",
        build: (secretKey, proposalId) => [
          mintReferenceToken(secretKey, { proposalId, subjectKind: "envelope_hash" }),
          mintReferenceToken(secretKey, { proposalId, subjectKind: "envelope_hash" }),
        ],
      },
    ];

    for (const attack of attacks) {
      const secretKey = randomBytes(32);
      const proposal = await registry.create({ content: `attack: ${attack.name}` });
      await advanceToIndependentReview(proposal.id);
      const verify = createReferenceTokenVerifier(secretKey);

      // Each token in the attack is submitted; a genuine-looking one MAY
      // legitimately be recorded (e.g. "one genuine + one fabricated" —
      // the genuine half is expected to succeed on its own), but the
      // ATTACK's own point is that the fabricated/mismatched/wrong-kind
      // ones never do — asserted below by the final promotion outcome,
      // which is the actual invariant under test: no attack in this
      // matrix ever accumulates 2 genuinely-verified, this-proposal-bound,
      // correctly-subject-kinded, DISTINCT approvals.
      for (const token of attack.build(secretKey, proposal.id)) {
        await registry.recordReviewApproval(proposal.id, token, verify).catch(() => undefined);
      }

      await expect(
        promoteProposal({ registry, proposalId: proposal.id, changeSetRefs: refs }),
      ).rejects.toThrow();
      expect((await registry.get(proposal.id))?.state).toBe("independent_review");
    }
  });
});
