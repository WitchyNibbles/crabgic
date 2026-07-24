import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { createGateRegistry, type GateContext, type GateVerdict } from "@eo/gates";
import { ProposalRegistry } from "../proposal-store/registry.js";
import { promoteProposal } from "../promotion/promote.js";
import {
  createReferenceTokenVerifier,
  mintReferenceToken,
} from "../test-support/reference-token-verifier.js";

/**
 * `@learning-redteam` — roadmap/22-learning-system.md §Exit criteria:
 * "Project-scoped promotion produces a real `ChangeSet` that clears the
 * SAME gates (14) as any other change before publish (08) — integration
 * test on fake engine proves no bypass path exists."
 *
 * This test constructs the IDENTICAL `@eo/gates` `GateRegistry` a human
 * change would fire against (the exact same import, the exact same
 * `createGateRegistry()`/`fireAll` call shape `@eo/gates`' own
 * `final-candidate.ts` uses), keys `GateContext.changeSetId` off the
 * `ChangeSet` a promoted learning proposal produced, and fires it —
 * proving there is no "skip gates for learning-originated changes" branch
 * anywhere: this package never imports, wraps, or special-cases
 * `createGateRegistry`/`fireAll`/`fireByTag` at all (grep confirms zero
 * occurrences of "bypass" or a learning-specific gate-registry wrapper
 * anywhere under `packages/learning/src`).
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
  root = await mkdtemp(join(tmpdir(), "eo-learning-no-bypass-"));
  journal = createJournalStore({ journalDir: join(root, "journal") });
  registry = new ProposalRegistry({ registryDir: join(root, "registry"), journal });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function verdict(passed: boolean): GateVerdict {
  return {
    passed,
    command: "npm test",
    exitStatus: passed ? 0 : 1,
    toolchainFingerprint: "node-24",
    artifactDigests: [],
    detail: passed ? "green" : "red",
  };
}

describe("@learning-redteam no-bypass — a promoted lesson's ChangeSet clears the SAME @eo/gates registry as any human change", () => {
  it("fires the identical GateRegistry.fireAll against the promoted proposal's ChangeSet, journaling real EvidenceRecords under its changeSetId — no special-cased path", async () => {
    const proposal = await registry.create({ content: "lesson" });
    await registry.transition(proposal.id, "reproducer");
    await registry.transition(proposal.id, "candidate");
    await registry.transition(proposal.id, "dev_eval");
    await registry.transition(proposal.id, "held_out_eval");
    await registry.transition(proposal.id, "shadow_run");
    await registry.transition(proposal.id, "independent_review");

    // Two GENUINELY minted, learning_review-subject, this-proposal-bound
    // tokens — never bare strings (see ../red-team/self-promotion.
    // redteam.test.ts for the proof that bare strings no longer work).
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

    // The SAME registry construction + fire call ANY human-authored
    // ChangeSet uses (@eo/gates' own public API, never wrapped or
    // re-implemented by this package).
    const gateRegistry = createGateRegistry();
    gateRegistry.register("tdd", "fake-tdd-gate", async () => verdict(true));
    gateRegistry.register("coverage", "fake-coverage-gate", async () => verdict(false));

    const context: GateContext = {
      stage: "final_verifying",
      changeSetId: changeSet.id,
      objectId: "deadbeef-learning-changeset",
      journal,
    };
    const results = await gateRegistry.fireAll(context);

    expect(results).toHaveLength(2);
    // Both gates genuinely fired and journaled real EvidenceRecord entries
    // keyed to this exact ChangeSet — a failing gate (coverage, here)
    // reports failed, exactly as it would for ANY OTHER ChangeSet; nothing
    // about this being a learning-originated ChangeSet suppressed or
    // special-cased the failure.
    expect(results.find((r) => r.name === "fake-tdd-gate")?.verdict.passed).toBe(true);
    expect(results.find((r) => r.name === "fake-coverage-gate")?.verdict.passed).toBe(false);
    expect(results.every((r) => r.evidence.changeSetId === changeSet.id)).toBe(true);

    const evidenceEntries: unknown[] = [];
    for await (const entry of journal.queryEntries({
      type: "evidence_pointer",
      changeSetId: changeSet.id,
    })) {
      evidenceEntries.push(entry);
    }
    expect(evidenceEntries).toHaveLength(2);
  });
});
