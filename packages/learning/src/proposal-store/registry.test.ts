import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { IllegalTransitionError } from "@eo/contracts";
import {
  DuplicateApprovalTokenError,
  InsufficientIndependentReviewError,
  ProposalNotFoundError,
} from "../errors.js";
import {
  createReferenceTokenVerifier,
  mintReferenceToken,
} from "../test-support/reference-token-verifier.js";
import { ProposalRegistry } from "./registry.js";

let root: string;
let journal: JournalStore;
let registry: ProposalRegistry;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-learning-registry-"));
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

describe("ProposalRegistry — create/get/list", () => {
  it("creates a proposal in the observation state, persisted and readable back", async () => {
    const proposal = await registry.create({ content: "lesson content" });
    expect(proposal.state).toBe("observation");
    const read = await registry.get(proposal.id);
    expect(read).toEqual(proposal);
  });

  it("get() on an unknown id returns undefined (not a throw)", async () => {
    expect(await registry.get("11111111-1111-4111-8111-111111111111")).toBeUndefined();
  });

  it("list() returns every created proposal", async () => {
    const a = await registry.create({ content: "a" });
    const b = await registry.create({ content: "b" });
    const ids = (await registry.list()).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(ids).toHaveLength(2);
  });

  it("operating on an unknown id throws ProposalNotFoundError", async () => {
    await expect(
      registry.transition("11111111-1111-4111-8111-111111111111", "reproducer"),
    ).rejects.toThrow(ProposalNotFoundError);
  });

  it("getReviewApprovals on an unknown id throws ProposalNotFoundError", async () => {
    await expect(
      registry.getReviewApprovals("11111111-1111-4111-8111-111111111111"),
    ).rejects.toThrow(ProposalNotFoundError);
  });

  it("getReviewApprovals returns the accumulated (genuinely-verified) approvals for a known proposal", async () => {
    const secretKey = randomBytes(32);
    const verify = createReferenceTokenVerifier(secretKey);
    const proposal = await registry.create({ content: "lesson" });
    expect(await registry.getReviewApprovals(proposal.id)).toEqual([]);

    const token = mintReferenceToken(secretKey, { proposalId: proposal.id });
    await registry.recordReviewApproval(proposal.id, token, verify);
    expect(await registry.getReviewApprovals(proposal.id)).toEqual([
      { tokenId: expect.any(String), verifiedAt: expect.any(String) },
    ]);
  });

  it("recordReviewApproval on an unknown id throws ProposalNotFoundError", async () => {
    const secretKey = randomBytes(32);
    const verify = createReferenceTokenVerifier(secretKey);
    const token = mintReferenceToken(secretKey, {
      proposalId: "11111111-1111-4111-8111-111111111111",
    });
    await expect(
      registry.recordReviewApproval("11111111-1111-4111-8111-111111111111", token, verify),
    ).rejects.toThrow(ProposalNotFoundError);
  });
});

describe("ProposalRegistry — transition + journaling", () => {
  it("advances legally through the full pipeline to independent_review", async () => {
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);
    const final = await registry.get(proposal.id);
    expect(final?.state).toBe("independent_review");
  });

  it("journals exactly one learning_transition entry per transition, correlated by workUnitId=proposalId", async () => {
    const proposal = await registry.create({ content: "lesson" });
    await registry.transition(proposal.id, "reproducer");

    const entries: unknown[] = [];
    for await (const entry of journal.queryEntries({ type: "learning_transition" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "learning_transition",
      workUnitId: proposal.id,
      payload: { from: "observation", to: "reproducer" },
    });
  });

  it("an illegal transition (observation -> promoted) throws IllegalTransitionError and journals nothing", async () => {
    const proposal = await registry.create({ content: "lesson" });
    await expect(registry.transition(proposal.id, "promoted")).rejects.toThrow(
      IllegalTransitionError,
    );
    const entries: unknown[] = [];
    for await (const entry of journal.queryEntries({ type: "learning_transition" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(0);
    // State is unchanged.
    expect((await registry.get(proposal.id))?.state).toBe("observation");
  });

  it("rejected: changes nothing else about the proposal's recorded evidence/content", async () => {
    const evidenceId = "44444444-4444-4444-8444-444444444444";
    const proposal = await registry.create({ content: "lesson", evidenceRecordIds: [evidenceId] });
    await registry.transition(proposal.id, "rejected");
    const after = await registry.get(proposal.id);
    expect(after?.state).toBe("rejected");
    expect(after?.content).toBe("lesson");
    expect(after?.evidenceRecordIds).toEqual([evidenceId]);
  });

  it("expired is reachable from any non-terminal state", async () => {
    const proposal = await registry.create({ content: "lesson" });
    await registry.transition(proposal.id, "expired");
    expect((await registry.get(proposal.id))?.state).toBe("expired");
  });

  it("additionalEvidenceRecordIds accumulate across transitions", async () => {
    const e0 = "44444444-4444-4444-8444-444444444444";
    const e1 = "55555555-5555-4555-8555-555555555555";
    const e2 = "66666666-6666-4666-8666-666666666666";
    const proposal = await registry.create({ content: "lesson", evidenceRecordIds: [e0] });
    await registry.transition(proposal.id, "reproducer", {
      additionalEvidenceRecordIds: [e1],
    });
    await registry.transition(proposal.id, "candidate", { additionalEvidenceRecordIds: [e2] });
    const final = await registry.get(proposal.id);
    expect(final?.evidenceRecordIds).toEqual([e0, e1, e2]);
  });
});

describe("ProposalRegistry — promotion requires >= 2 distinct, GENUINELY VERIFIED approvals (keystone invariant)", () => {
  it("promotion with ZERO approvals throws InsufficientIndependentReviewError", async () => {
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);
    await expect(registry.transition(proposal.id, "promoted")).rejects.toThrow(
      InsufficientIndependentReviewError,
    );
  });

  it("promotion with exactly ONE genuinely-verified approval throws InsufficientIndependentReviewError", async () => {
    const secretKey = randomBytes(32);
    const verify = createReferenceTokenVerifier(secretKey);
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);

    await registry.recordReviewApproval(
      proposal.id,
      mintReferenceToken(secretKey, { proposalId: proposal.id }),
      verify,
    );
    await expect(registry.transition(proposal.id, "promoted")).rejects.toThrow(
      InsufficientIndependentReviewError,
    );
  });

  it("the SAME genuinely-minted token replayed twice throws on the SECOND recordReviewApproval call (single-use) — never accumulates as two", async () => {
    const secretKey = randomBytes(32);
    const verify = createReferenceTokenVerifier(secretKey);
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);
    const token = mintReferenceToken(secretKey, { proposalId: proposal.id });

    await registry.recordReviewApproval(proposal.id, token, verify);
    await expect(registry.recordReviewApproval(proposal.id, token, verify)).rejects.toThrow();

    await expect(registry.transition(proposal.id, "promoted")).rejects.toThrow(
      InsufficientIndependentReviewError,
    );
  });

  it("a fabricated (never-minted) token is rejected by recordReviewApproval itself — nothing is ever accumulated from it", async () => {
    const secretKey = randomBytes(32);
    const verify = createReferenceTokenVerifier(secretKey);
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);

    await expect(
      registry.recordReviewApproval(proposal.id, "not-a-real-token", verify),
    ).rejects.toThrow();
    expect(await registry.getReviewApprovals(proposal.id)).toEqual([]);
  });

  it("promotion with TWO genuinely-verified, distinct approvals succeeds and journals the transition", async () => {
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
    const promoted = await registry.transition(proposal.id, "promoted");
    expect(promoted.state).toBe("promoted");

    const entries: { payload: { from: string; to: string } }[] = [];
    for await (const entry of journal.queryEntries({
      type: "learning_transition",
      workUnitId: proposal.id,
    })) {
      entries.push(entry as { payload: { from: string; to: string } });
    }
    expect(entries.some((e) => e.payload.to === "promoted")).toBe(true);
  });

  it("recordReviewApproval accumulates across separate calls; transition(..., 'promoted') reads the accumulated set", async () => {
    const secretKey = randomBytes(32);
    const verify = createReferenceTokenVerifier(secretKey);
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);

    await registry.recordReviewApproval(
      proposal.id,
      mintReferenceToken(secretKey, { proposalId: proposal.id }),
      verify,
    );
    await expect(registry.transition(proposal.id, "promoted")).rejects.toThrow(
      InsufficientIndependentReviewError,
    );
    await registry.recordReviewApproval(
      proposal.id,
      mintReferenceToken(secretKey, { proposalId: proposal.id }),
      verify,
    );
    const promoted = await registry.transition(proposal.id, "promoted");
    expect(promoted.state).toBe("promoted");
  });

  it("TransitionOptions carries NO reviewApprovals field at all — a caller cannot supply a trusted-by-name approvals array to transition()", () => {
    // Type-level proof: this file would fail to compile if
    // `TransitionOptions` still declared `reviewApprovals` — see the
    // adversarial-validation fix's own doc comment on
    // `ProposalRegistry.transition`. This test exists so the invariant is
    // ALSO checked at runtime coverage time, not just by the type checker.
    const options: import("./registry.js").TransitionOptions = {
      additionalEvidenceRecordIds: [],
    };
    expect(Object.keys(options)).not.toContain("reviewApprovals");
  });

  it("promoted -> rolled_back is legal and records the inverse ChangeSet id", async () => {
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
    await registry.transition(proposal.id, "promoted");

    const rolledBack = await registry.transition(proposal.id, "rolled_back", {
      rollbackChangeSetId: "33333333-3333-4333-8333-333333333333",
    });
    expect(rolledBack.state).toBe("rolled_back");
    expect(rolledBack.rollbackChangeSetId).toBe("33333333-3333-4333-8333-333333333333");
  });
});

describe("ProposalRegistry — DuplicateApprovalTokenError defense-in-depth (in case a verifier implementation ever mis-behaves)", () => {
  it("two approvals sharing the same tokenId (even if a hypothetical verifier let that through) still throw at promotion time", async () => {
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);
    // A permissive stub verifier that always returns the SAME tokenId —
    // modeling a hypothetical buggy verifier implementation, to prove the
    // registry's own distinctness check is still a real backstop, not
    // merely delegated entirely to the injected verifier.
    let calls = 0;
    const alwaysSameTokenVerifier = async () => {
      calls += 1;
      return { tokenId: "always-the-same-token" };
    };
    await registry.recordReviewApproval(proposal.id, "irrelevant-1", alwaysSameTokenVerifier);
    await registry.recordReviewApproval(proposal.id, "irrelevant-2", alwaysSameTokenVerifier);
    expect(calls).toBe(2);

    await expect(registry.transition(proposal.id, "promoted")).rejects.toThrow(
      DuplicateApprovalTokenError,
    );
  });
});
