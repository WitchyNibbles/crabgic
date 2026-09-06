import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { ProposalRegistry } from "../proposal-store/registry.js";
import {
  createReferenceTokenVerifier,
  mintReferenceToken,
} from "../test-support/reference-token-verifier.js";
import { sweepExpiredProposals } from "./expiry-sweeper.js";

const STALE_EVIDENCE_ID = "55555555-5555-4555-8555-555555555555";
const FRESH_EVIDENCE_ID = "66666666-6666-4666-8666-666666666666";

let root: string;
let journal: JournalStore;
let registry: ProposalRegistry;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-learning-expiry-"));
  journal = createJournalStore({ journalDir: join(root, "journal") });
  registry = new ProposalRegistry({ registryDir: join(root, "registry"), journal });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function isStale(id: string): Promise<boolean> {
  return id === STALE_EVIDENCE_ID;
}

describe("sweepExpiredProposals", () => {
  it("expires a non-terminal proposal referencing a stale EvidenceRecord", async () => {
    const proposal = await registry.create({
      content: "lesson",
      evidenceRecordIds: [STALE_EVIDENCE_ID],
    });
    const result = await sweepExpiredProposals(registry, isStale);
    expect(result.expiredProposalIds).toEqual([proposal.id]);
    expect((await registry.get(proposal.id))?.state).toBe("expired");
  });

  it("leaves a proposal alone when its evidence references are all fresh", async () => {
    const proposal = await registry.create({
      content: "lesson",
      evidenceRecordIds: [FRESH_EVIDENCE_ID],
    });
    const result = await sweepExpiredProposals(registry, isStale);
    expect(result.expiredProposalIds).toEqual([]);
    expect((await registry.get(proposal.id))?.state).toBe("observation");
  });

  it("skips proposals with no evidence references at all", async () => {
    await registry.create({ content: "lesson" });
    const result = await sweepExpiredProposals(registry, isStale);
    expect(result.expiredProposalIds).toEqual([]);
  });

  it("skips proposals already in a terminal state", async () => {
    const proposal = await registry.create({
      content: "lesson",
      evidenceRecordIds: [STALE_EVIDENCE_ID],
    });
    await registry.transition(proposal.id, "rejected");
    const result = await sweepExpiredProposals(registry, isStale);
    expect(result.expiredProposalIds).toEqual([]);
    expect((await registry.get(proposal.id))?.state).toBe("rejected");
  });

  it("expires even an already-promoted proposal (promoted -> expired is a legal edge)", async () => {
    const proposal = await registry.create({
      content: "lesson",
      evidenceRecordIds: [STALE_EVIDENCE_ID],
    });
    await registry.transition(proposal.id, "reproducer");
    await registry.transition(proposal.id, "candidate");
    await registry.transition(proposal.id, "dev_eval");
    await registry.transition(proposal.id, "held_out_eval");
    await registry.transition(proposal.id, "shadow_run");
    await registry.transition(proposal.id, "independent_review");
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
    await registry.transition(proposal.id, "promoted");

    const result = await sweepExpiredProposals(registry, isStale);
    expect(result.expiredProposalIds).toEqual([proposal.id]);
    expect((await registry.get(proposal.id))?.state).toBe("expired");
  });

  /**
   * `independent_review` is non-terminal but has NO `expired` edge — the state
   * machine says so deliberately: "an expiry concern discovered during review
   * is modeled as a `rejected` verdict with rationale, not a distinct edge."
   * The sweeper reached the transition anyway, so `registry.transition(id,
   * "expired")` threw `IllegalTransitionError` and took the whole sweep with
   * it — every proposal after this one in the list went unswept.
   */
  it("reports a stale under-review proposal instead of throwing, and still sweeps the rest", async () => {
    const underReview = await registry.create({
      content: "under review",
      evidenceRecordIds: [STALE_EVIDENCE_ID],
    });
    for (const next of [
      "reproducer",
      "candidate",
      "dev_eval",
      "held_out_eval",
      "shadow_run",
      "independent_review",
    ] as const) {
      await registry.transition(underReview.id, next);
    }
    // Created second, so `registry.list()` reaches it AFTER the under-review
    // one: if the sweep aborts, this is the proposal that goes unswept.
    const sweepable = await registry.create({
      content: "sweepable",
      evidenceRecordIds: [STALE_EVIDENCE_ID],
    });

    const result = await sweepExpiredProposals(registry, isStale);

    expect(result.staleUnderReviewProposalIds).toEqual([underReview.id]);
    expect((await registry.get(underReview.id))?.state).toBe("independent_review");
    expect(result.expiredProposalIds).toEqual([sweepable.id]);
    expect((await registry.get(sweepable.id))?.state).toBe("expired");
  });
});
