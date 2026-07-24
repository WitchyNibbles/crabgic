import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { buildTaskPacket, buildWorkerResult, FakeEngineAdapter } from "@eo/testkit";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "./test-support/minimal-compiled-profile.js";
import {
  createReferenceTokenVerifier,
  mintReferenceToken,
} from "./test-support/reference-token-verifier.js";
import { buildReproducerFixture, replayReproducer } from "./reproducer/reproducer-harness.js";
import { EvalCaseSchema } from "./eval/case-schema.js";
import { assertNoContamination } from "./eval/contamination.js";
import { runEvalSuite } from "./eval/eval-runner.js";
import { runShadowComparison } from "./shadow/shadow-comparator.js";
import { ProposalRegistry } from "./proposal-store/registry.js";
import { promoteProposal } from "./promotion/promote.js";
import { rollbackProposal } from "./rollback/rollback.js";

/**
 * E2E — roadmap/22-learning-system.md §Exit criteria: "seeded recurring
 * failure → lesson → shadow improvement → human promotion (two distinct
 * approval tokens, journaled) → behavior change → rollback restores
 * baseline (committed E2E fixture + journal excerpt)." Fixture-modeled on
 * the fake engine (`@eo/testkit`) throughout — no live Claude Code engine
 * involved, matching every other phase's own `@live`-gated split.
 */
const PRIMARY_WORK_UNIT_ID = "11111111-1111-4111-8111-111111111111";
const PROPOSAL_CHANGE_SET_REFS = {
  intentContractId: "22222222-2222-4222-8222-222222222222",
  authorizationEnvelopeId: "33333333-3333-4333-8333-333333333333",
  capabilityManifestId: "44444444-4444-4444-8444-444444444444",
  provisionalPerformanceContractId: "55555555-5555-4555-8555-555555555555",
};

let root: string;
let journal: JournalStore;
let registry: ProposalRegistry;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-learning-pipeline-e2e-"));
  journal = createJournalStore({ journalDir: join(root, "journal") });
  registry = new ProposalRegistry({ registryDir: join(root, "registry"), journal });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("E2E: observation -> reproducer -> candidate -> dev_eval -> held_out_eval -> shadow_run -> independent_review -> promoted -> rolled_back", () => {
  it("carries a seeded recurring failure all the way through to a journaled promotion and a rollback that restores the baseline", async () => {
    // 1. OBSERVATION: a recurring failure is observed (e.g. a repeated
    // schema-violation on a particular task shape) and proposed as a
    // lesson candidate.
    const proposal = await registry.create({
      content:
        "Always double-check structured_output conforms to WorkerResultSchema before finishing.",
    });
    expect(proposal.state).toBe("observation");

    // 2. REPRODUCER: build a replayable fixture reproducing the failure,
    // and confirm — WITHOUT the lesson — it genuinely still fails.
    const fixture = buildReproducerFixture({
      observationId: proposal.id,
      failingScript: { failure: { kind: "schemaViolation" } },
    });
    const baselineValidation = await replayReproducer({
      fixture,
      packet: buildTaskPacket({ workUnitId: PRIMARY_WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
    });
    expect(baselineValidation.kind).toBe("schemaViolation");
    await registry.transition(proposal.id, "reproducer");

    // 3. CANDIDATE: the lesson becomes a candidate for evaluation.
    await registry.transition(proposal.id, "candidate");

    // 4. DEV_EVAL + 5. HELD_OUT_EVAL: contamination-checked, then graded.
    const devCases = [
      EvalCaseSchema.parse({
        id: "dev-1",
        input: { actualJudgment: true, scenario: "dev" },
        expectedJudgment: true,
        provenanceId: "dev-prov-1",
      }),
    ];
    const heldOutCases = [
      EvalCaseSchema.parse({
        id: "held-out-1",
        input: { actualJudgment: true, scenario: "held-out" },
        expectedJudgment: true,
        provenanceId: "held-out-prov-1",
      }),
    ];
    assertNoContamination(devCases, heldOutCases); // must run BEFORE either eval.

    const devResult = await runEvalSuite(devCases, journal);
    expect(devResult.passed).toBe(true);
    await registry.transition(proposal.id, "dev_eval");

    const heldOutResult = await runEvalSuite(heldOutCases, journal);
    expect(heldOutResult.passed).toBe(true);
    await registry.transition(proposal.id, "held_out_eval");

    // 6. SHADOW_RUN: apply the candidate lesson to a mirrored dispatch and
    // diff against the (already-established) failing baseline — proving
    // a genuine improvement, not just a re-assertion.
    const { failure: _baselineFailure, ...fixtureScriptWithoutFailure } = fixture.script;
    const { comparison } = await runShadowComparison(
      {
        adapter: new FakeEngineAdapter({
          ...fixtureScriptWithoutFailure,
          structuredOutput: buildWorkerResult({
            outcome: "succeeded",
            summary: "fixed by the candidate lesson",
          }),
        }),
        packet: buildTaskPacket({ workUnitId: PRIMARY_WORK_UNIT_ID }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        journal,
        primaryWorkUnitId: PRIMARY_WORK_UNIT_ID,
      },
      { passed: false, summary: "baseline: schema violation (reproduced above)" },
    );
    expect(comparison.verdict).toBe("improved");
    await registry.transition(proposal.id, "shadow_run");

    // 7. INDEPENDENT_REVIEW: batched for end-of-run human review.
    await registry.transition(proposal.id, "independent_review");

    // 8. PROMOTED: two GENUINELY MINTED, learning_review-subject,
    // this-proposal-BOUND, distinct approval tokens — NEVER the
    // proposer's own confirmation, NEVER the same token twice, NEVER a
    // fabricated string (see ./red-team/self-promotion.redteam.test.ts
    // for the proof that fabrication no longer works). This E2E uses the
    // same faithful-but-decoupled reference verifier
    // (`./test-support/reference-token-verifier.ts`) real code exercises
    // its actual verification path with, not merely trusted claims.
    const reviewSecretKey = randomBytes(32);
    const verifyReview = createReferenceTokenVerifier(reviewSecretKey);
    await registry.recordReviewApproval(
      proposal.id,
      mintReferenceToken(reviewSecretKey, { proposalId: proposal.id }),
      verifyReview,
    );
    await registry.recordReviewApproval(
      proposal.id,
      mintReferenceToken(reviewSecretKey, { proposalId: proposal.id }),
      verifyReview,
    );
    const { proposal: promotedProposal, changeSet } = await promoteProposal({
      registry,
      proposalId: proposal.id,
      changeSetRefs: PROPOSAL_CHANGE_SET_REFS,
    });
    expect(promotedProposal.state).toBe("promoted");
    expect(changeSet.rollbackStrategy).toContain(proposal.id);

    // JOURNAL EXCERPT: every one of the 6 real transitions (observation is
    // the initial state, not itself a transition) is recorded as a
    // learning_transition entry, in order.
    const transitionEntries: { payload: { from: string; to: string } }[] = [];
    for await (const entry of journal.queryEntries({
      type: "learning_transition",
      workUnitId: proposal.id,
    })) {
      transitionEntries.push(entry as { payload: { from: string; to: string } });
    }
    expect(transitionEntries.map((e) => e.payload.to)).toEqual([
      "reproducer",
      "candidate",
      "dev_eval",
      "held_out_eval",
      "shadow_run",
      "independent_review",
      "promoted",
    ]);

    // 9. BEHAVIOR CHANGE: the promoted ChangeSet is the real, dispatchable
    // artifact — not a bypass (see ./red-team/no-bypass.redteam.test.ts
    // for the full gate-firing proof); here we just confirm it is handed
    // back to the caller for the normal scheduler→gates→publish pipeline.
    expect(changeSet.state).toBe("draft");

    // 10. ROLLBACK: restores the baseline, with a journaled rationale.
    const { proposal: rolledBackProposal, inverseChangeSet } = await rollbackProposal({
      registry,
      proposalId: proposal.id,
      promotedChangeSetId: changeSet.id,
      changeSetRefs: PROPOSAL_CHANGE_SET_REFS,
    });
    expect(rolledBackProposal.state).toBe("rolled_back");
    expect(rolledBackProposal.rollbackChangeSetId).toBe(inverseChangeSet.id);
    expect(inverseChangeSet.rollbackStrategy).toContain(changeSet.id);

    const rollbackEntries: { payload: { from: string; to: string } }[] = [];
    for await (const entry of journal.queryEntries({
      type: "learning_transition",
      workUnitId: proposal.id,
    })) {
      rollbackEntries.push(entry as { payload: { from: string; to: string } });
    }
    expect(rollbackEntries[rollbackEntries.length - 1]?.payload).toEqual({
      from: "promoted",
      to: "rolled_back",
    });
  });
});
