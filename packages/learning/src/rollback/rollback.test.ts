import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { ProposalRegistry } from "../proposal-store/registry.js";
import { NotPromotedError } from "../errors.js";
import { promoteProposal } from "../promotion/promote.js";
import {
  createReferenceTokenVerifier,
  mintReferenceToken,
} from "../test-support/reference-token-verifier.js";
import { rollbackProposal } from "./rollback.js";

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
  root = await mkdtemp(join(tmpdir(), "eo-learning-rollback-"));
  journal = createJournalStore({ journalDir: join(root, "journal") });
  registry = new ProposalRegistry({ registryDir: join(root, "registry"), journal });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function promoteFreshProposal(): Promise<{
  readonly proposalId: string;
  readonly changeSetId: string;
}> {
  const secretKey = randomBytes(32);
  const verify = createReferenceTokenVerifier(secretKey);
  const proposal = await registry.create({ content: "lesson" });
  await registry.transition(proposal.id, "reproducer");
  await registry.transition(proposal.id, "candidate");
  await registry.transition(proposal.id, "dev_eval");
  await registry.transition(proposal.id, "held_out_eval");
  await registry.transition(proposal.id, "shadow_run");
  await registry.transition(proposal.id, "independent_review");
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
  const result = await promoteProposal({ registry, proposalId: proposal.id, changeSetRefs: refs });
  return { proposalId: proposal.id, changeSetId: result.changeSet.id };
}

describe("rollbackProposal", () => {
  it("rolls back a promoted proposal, producing an inverse ChangeSet and recording its id", async () => {
    const { proposalId, changeSetId } = await promoteFreshProposal();

    const result = await rollbackProposal({
      registry,
      proposalId,
      promotedChangeSetId: changeSetId,
      changeSetRefs: refs,
    });

    expect(result.proposal.state).toBe("rolled_back");
    expect(result.proposal.rollbackChangeSetId).toBe(result.inverseChangeSet.id);
    expect(result.inverseChangeSet.rollbackStrategy).toContain(changeSetId);
  });

  it("defaults promotedChangeSetId to whatever promoteProposal recorded, when the caller omits it", async () => {
    const { proposalId, changeSetId } = await promoteFreshProposal();

    const result = await rollbackProposal({ registry, proposalId, changeSetRefs: refs });

    expect(result.proposal.state).toBe("rolled_back");
    expect(result.inverseChangeSet.rollbackStrategy).toContain(changeSetId);
  });

  it("refuses rollback on a proposal that was never promoted", async () => {
    const proposal = await registry.create({ content: "lesson" });
    await expect(
      rollbackProposal({
        registry,
        proposalId: proposal.id,
        promotedChangeSetId: "some-cs-id",
        changeSetRefs: refs,
      }),
    ).rejects.toThrow(NotPromotedError);
  });

  it("refuses rollback on an unknown proposal id", async () => {
    await expect(
      rollbackProposal({
        registry,
        proposalId: "11111111-1111-4111-8111-111111111111",
        promotedChangeSetId: "some-cs-id",
        changeSetRefs: refs,
      }),
    ).rejects.toThrow(NotPromotedError);
  });
});
