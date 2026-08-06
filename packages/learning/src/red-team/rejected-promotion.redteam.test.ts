import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { IllegalTransitionError } from "@crabgic/contracts";
import { ProposalRegistry } from "../proposal-store/registry.js";
import { promoteProposal } from "../promotion/promote.js";
import {
  createReferenceTokenVerifier,
  mintReferenceToken,
} from "../test-support/reference-token-verifier.js";

/**
 * `@learning-redteam` — roadmap/22-learning-system.md §Exit criteria:
 * "… rejected promotion changes nothing … — each a separate passing case in
 * the `@learning-redteam` suite."
 *
 * The behaviour itself is already pinned by
 * `../proposal-store/registry.test.ts` ("rejected: changes nothing else about
 * the proposal's recorded evidence/content"). What that case does not do — and
 * what makes this one adversarial rather than a duplicate — is take the
 * proposal all the way to `independent_review` WITH two genuinely minted
 * approvals already banked, reject it there, and then attempt the promotion
 * anyway. That is the shape an attacker actually has: not "reject a fresh
 * observation", but "reject at the last gate and then push through regardless".
 *
 * Three separable claims, each asserted:
 *   1. rejection mutates NOTHING but `state` (whole-record equality, not
 *      `toMatchObject`, so a silently added or dropped member reddens);
 *   2. the banked approvals do not survive as a promotion route — the
 *      TYPED error is asserted, not a bare `toThrow()`;
 *   3. nothing is journaled after the rejection, so the refusal is terminal
 *      rather than merely unreported.
 */
const refs = {
  intentContractId: "11111111-1111-4111-8111-111111111111",
  authorizationEnvelopeId: "22222222-2222-4222-8222-222222222222",
  capabilityManifestId: "33333333-3333-4333-8333-333333333333",
  provisionalPerformanceContractId: "44444444-4444-4444-8444-444444444444",
};
const EVIDENCE_ID = "99999999-9999-4999-8999-999999999999";

let root: string;
let journal: JournalStore;
let registry: ProposalRegistry;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-learning-rejected-rt-"));
  journal = createJournalStore({ journalDir: join(root, "journal") });
  registry = new ProposalRegistry({ registryDir: join(root, "registry"), journal });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function transitionsOf(proposalId: string): Promise<{ from: string; to: string }[]> {
  const out: { from: string; to: string }[] = [];
  for await (const entry of journal.queryEntries({
    type: "learning_transition",
    workUnitId: proposalId,
  })) {
    out.push((entry as { payload: { from: string; to: string } }).payload);
  }
  return out;
}

describe("@learning-redteam rejected promotion — rejecting changes nothing and closes the promote path for good", () => {
  it("rejection at independent_review leaves the record identical but for `state`, and promotion afterwards is refused with the typed error", async () => {
    const proposal = await registry.create({
      content: "lesson",
      evidenceRecordIds: [EVIDENCE_ID],
    });
    for (const to of [
      "reproducer",
      "candidate",
      "dev_eval",
      "held_out_eval",
      "shadow_run",
      "independent_review",
    ] as const) {
      await registry.transition(proposal.id, to);
    }

    // Two GENUINELY minted, this-proposal-bound, distinct tokens are banked
    // BEFORE the rejection — so if rejection left any promote route open, the
    // two-distinct-token bar would already be cleared and nothing else would
    // stand in the way.
    const secretKey = randomBytes(32);
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
    expect((await registry.getReviewApprovals(proposal.id)).length).toBe(2);

    const before = await registry.get(proposal.id);
    expect(before?.state).toBe("independent_review");

    await registry.transition(proposal.id, "rejected");
    const after = await registry.get(proposal.id);
    expect(after?.state).toBe("rejected");

    // Whole-record equality, not `toMatchObject`: `LearningProposal` carries
    // no `updatedAt`-style member (checked against
    // `@crabgic/contracts`'s schema), so `state` is the ONLY field that may
    // legitimately have moved. Anything else appearing or vanishing reddens.
    expect({ ...after!, state: before!.state }).toEqual(before);

    // The banked approvals did not become a promotion route.
    await expect(
      promoteProposal({ registry, proposalId: proposal.id, changeSetRefs: refs }),
    ).rejects.toThrow(IllegalTransitionError);

    // …and it is still rejected, with nothing journaled after the rejection.
    expect((await registry.get(proposal.id))?.state).toBe("rejected");
    const transitions = await transitionsOf(proposal.id);
    expect(transitions.at(-1)).toEqual({ from: "independent_review", to: "rejected" });
    expect(transitions.filter((t) => t.to === "promoted")).toEqual([]);
  });

  it("CONTROL: the identical setup WITHOUT the rejection does promote — so the refusal above is the rejection's doing, not a broken promote path", async () => {
    const proposal = await registry.create({
      content: "lesson",
      evidenceRecordIds: [EVIDENCE_ID],
    });
    for (const to of [
      "reproducer",
      "candidate",
      "dev_eval",
      "held_out_eval",
      "shadow_run",
      "independent_review",
    ] as const) {
      await registry.transition(proposal.id, to);
    }
    const secretKey = randomBytes(32);
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

    const { proposal: promoted } = await promoteProposal({
      registry,
      proposalId: proposal.id,
      changeSetRefs: refs,
    });
    expect(promoted.state).toBe("promoted");
  });
});
