import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { ProposalRegistry } from "../proposal-store/registry.js";
import { promoteProposal } from "../promotion/promote.js";
import { rollbackProposal } from "../rollback/rollback.js";
import { sweepExpiredProposals } from "../expiry/expiry-sweeper.js";
import {
  createReferenceTokenVerifier,
  mintReferenceToken,
} from "../test-support/reference-token-verifier.js";

/**
 * `@learning-redteam` — roadmap/22-learning-system.md §Exit criteria:
 * "… expiry + rollback work — EACH a separate passing case in the
 * `@learning-redteam` suite." Two behaviours, therefore two `it`s, so the
 * criterion's "each" holds per behaviour rather than per file.
 *
 * Framed adversarially rather than as a copy of `../expiry/expiry-sweeper.test.ts`
 * and `../rollback/rollback.test.ts`:
 *   - expiry: a lesson whose grounding evidence has gone stale must not keep
 *     operating, and a SIBLING lesson with fresh evidence must survive the same
 *     sweep — a sweeper that expires everything would satisfy a one-proposal
 *     test equally well.
 *   - rollback: a promoted lesson is genuinely promoted first (two real,
 *     distinct, this-proposal-bound tokens), then rolled back, and the inverse
 *     `ChangeSet` must NAME the ChangeSet it reverses — an inverse that points
 *     at nothing restores nothing.
 */
const refs = {
  intentContractId: "11111111-1111-4111-8111-111111111111",
  authorizationEnvelopeId: "22222222-2222-4222-8222-222222222222",
  capabilityManifestId: "33333333-3333-4333-8333-333333333333",
  provisionalPerformanceContractId: "44444444-4444-4444-8444-444444444444",
};
const STALE_EVIDENCE_ID = "55555555-5555-4555-8555-555555555555";
const FRESH_EVIDENCE_ID = "66666666-6666-4666-8666-666666666666";

let root: string;
let journal: JournalStore;
let registry: ProposalRegistry;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-learning-expiry-rollback-rt-"));
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

describe("@learning-redteam expiry — a lesson standing on stale evidence cannot keep operating", () => {
  it("expires exactly the stale-evidence lesson, journals the transition, and leaves its fresh-evidence sibling untouched", async () => {
    const stale = await registry.create({
      content: "lesson grounded in evidence that has since gone stale",
      evidenceRecordIds: [STALE_EVIDENCE_ID],
    });
    const fresh = await registry.create({
      content: "lesson whose evidence is still current",
      evidenceRecordIds: [FRESH_EVIDENCE_ID],
    });

    const result = await sweepExpiredProposals(registry, async (id) => id === STALE_EVIDENCE_ID);

    expect(result.expiredProposalIds).toEqual([stale.id]);
    expect((await registry.get(stale.id))?.state).toBe("expired");
    // The control that rules out "expires everything": same sweep, same call.
    expect((await registry.get(fresh.id))?.state).toBe("observation");

    expect(await transitionsOf(stale.id)).toEqual([{ from: "observation", to: "expired" }]);
    expect(await transitionsOf(fresh.id)).toEqual([]);
  });
});

describe("@learning-redteam rollback — a promoted lesson is genuinely reversible", () => {
  it("rolls a promoted proposal back, recording an inverse ChangeSet that NAMES the promoted one, with the reversal journaled last", async () => {
    const proposal = await registry.create({ content: "lesson" });
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
    const { changeSet } = await promoteProposal({
      registry,
      proposalId: proposal.id,
      changeSetRefs: refs,
    });

    const { proposal: rolledBack, inverseChangeSet } = await rollbackProposal({
      registry,
      proposalId: proposal.id,
      changeSetRefs: refs,
    });

    expect(rolledBack.state).toBe("rolled_back");
    expect(rolledBack.rollbackChangeSetId).toBe(inverseChangeSet.id);
    // An inverse that does not name what it reverses restores nothing.
    expect(inverseChangeSet.rollbackStrategy).toContain(changeSet.id);
    expect(inverseChangeSet.id).not.toBe(changeSet.id);

    expect((await transitionsOf(proposal.id)).at(-1)).toEqual({
      from: "promoted",
      to: "rolled_back",
    });
  });
});
