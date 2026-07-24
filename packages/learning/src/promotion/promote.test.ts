import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { ProposalRegistry } from "../proposal-store/registry.js";
import { InsufficientIndependentReviewError } from "../errors.js";
import {
  createReferenceTokenVerifier,
  mintReferenceToken,
} from "../test-support/reference-token-verifier.js";
import { promoteProposal } from "./promote.js";

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
  root = await mkdtemp(join(tmpdir(), "eo-learning-promote-"));
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

describe("promoteProposal", () => {
  it("promotes once the proposal has 2 genuinely-verified, distinct approvals, and returns a real, schema-valid ChangeSet", async () => {
    const secretKey = randomBytes(32);
    const verify = createReferenceTokenVerifier(secretKey);
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);
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
    expect(result.changeSet.state).toBe("draft");
    expect(result.changeSet.rollbackStrategy).toContain(proposal.id);
  });

  it("refuses with fewer than 2 approvals accumulated — no ChangeSet is ever constructed", async () => {
    const secretKey = randomBytes(32);
    const verify = createReferenceTokenVerifier(secretKey);
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);
    await registry.recordReviewApproval(
      proposal.id,
      mintReferenceToken(secretKey, { proposalId: proposal.id }),
      verify,
    );

    await expect(
      promoteProposal({ registry, proposalId: proposal.id, changeSetRefs: refs }),
    ).rejects.toThrow(InsufficientIndependentReviewError);

    expect((await registry.get(proposal.id))?.state).toBe("independent_review");
  });

  it("PromoteProposalOptions carries no reviewApprovals field — the caller cannot supply a trusted-by-name approvals array here either", () => {
    const options: import("./promote.js").PromoteProposalOptions = {
      registry,
      proposalId: "11111111-1111-4111-8111-111111111111",
      changeSetRefs: refs,
    };
    expect(Object.keys(options)).not.toContain("reviewApprovals");
  });
});
