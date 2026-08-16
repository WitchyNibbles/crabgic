import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import {
  createAuthorizationEnvelopesRegistry,
  createChangeSetsRegistry,
  createIntentContractsRegistry,
  createRequirementsRegistry,
  createWorkUnitsRegistry,
} from "@crabgic/supervisor";
import { buildAuthorizationEnvelope, buildChangeSet, buildIntentContract } from "@crabgic/testkit";
import { ApprovalTokenMinter } from "../approval/token.js";
import { completeEnvelopeApproval } from "./complete-envelope-approval.js";
import type { StageCompletionRecord } from "@crabgic/contracts";
/**
 * A closed `design-gate` — owner ruling R8.
 *
 * Passed per call rather than baked into `seededDeps()`, because each case
 * builds its own ChangeSet after the deps and the closure must name the one
 * actually under approval. A blanket pass would make the "different ChangeSet"
 * arm meaningless.
 */
function designGateClosed(changeSetId: string): StageCompletionRecord[] {
  return [
    {
      schemaVersion: 1,
      changeSetId,
      stage: "design-gate",
      round: 1,
      artifactRef: "design-record:test",
      closedAt: "2026-08-16T00:00:00.000Z",
    },
  ];
}

const secretKey = randomBytes(32);

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-cli-complete-approval-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function seededDeps() {
  return {
    secretKey,
    journal: store,
    changeSets: createChangeSetsRegistry(),
    envelopes: createAuthorizationEnvelopesRegistry(),
    intentContracts: createIntentContractsRegistry(),
    requirements: createRequirementsRegistry(),
    workUnits: createWorkUnitsRegistry(),
  };
}

describe("completeEnvelopeApproval", () => {
  it("verifies the freshly-minted token and advances awaiting_approval → ready", async () => {
    const deps = seededDeps();
    const digest = "sha256:complete-approval-happy";
    const envelope = buildAuthorizationEnvelope({ id: randomUUID(), canonicalHash: digest });
    deps.envelopes.put(envelope);
    const contract = buildIntentContract({ id: randomUUID(), requirementIds: [] });
    deps.intentContracts.put(contract);
    const changeSet = buildChangeSet({
      id: randomUUID(),
      state: "awaiting_approval",
      authorizationEnvelopeId: envelope.id,
      intentContractId: contract.id,
    });
    deps.changeSets.put(changeSet);

    const minter = new ApprovalTokenMinter({ secretKey });
    const minted = await minter.mint("envelope_hash", digest);

    const result = await completeEnvelopeApproval(changeSet, digest, minted.token, {
      ...deps,
      stageCompletions: designGateClosed(changeSet.id),
    });
    expect(result.approved).toBe(true);
    if (!result.approved) throw new Error("unreachable");
    expect(result.changeSet.state).toBe("ready");
    expect(deps.changeSets.get(changeSet.id)?.state).toBe("ready");
  });

  it("fails closed when the ChangeSet's IntentContract is not in the durable store", async () => {
    const deps = seededDeps();
    const digest = "sha256:complete-approval-no-contract";
    const envelope = buildAuthorizationEnvelope({ id: randomUUID(), canonicalHash: digest });
    deps.envelopes.put(envelope);
    const changeSet = buildChangeSet({
      id: randomUUID(),
      state: "awaiting_approval",
      authorizationEnvelopeId: envelope.id,
      intentContractId: randomUUID(),
    });
    deps.changeSets.put(changeSet);

    const minter = new ApprovalTokenMinter({ secretKey });
    const minted = await minter.mint("envelope_hash", digest);

    const result = await completeEnvelopeApproval(changeSet, digest, minted.token, {
      ...deps,
      stageCompletions: designGateClosed(changeSet.id),
    });
    expect(result.approved).toBe(false);
    if (result.approved) throw new Error("unreachable");
    expect(result.reason).toContain("no resolvable IntentContract");
  });

  it("a spent token cannot approve twice — the durable single-use ledger holds in-process too", async () => {
    const deps = seededDeps();
    const digest = "sha256:complete-approval-replay";
    const envelope = buildAuthorizationEnvelope({ id: randomUUID(), canonicalHash: digest });
    deps.envelopes.put(envelope);
    const contract = buildIntentContract({ id: randomUUID(), requirementIds: [] });
    deps.intentContracts.put(contract);
    const changeSet = buildChangeSet({
      id: randomUUID(),
      state: "awaiting_approval",
      authorizationEnvelopeId: envelope.id,
      intentContractId: contract.id,
    });
    deps.changeSets.put(changeSet);

    const minter = new ApprovalTokenMinter({ secretKey });
    const minted = await minter.mint("envelope_hash", digest);
    const first = await completeEnvelopeApproval(changeSet, digest, minted.token, {
      ...deps,
      stageCompletions: designGateClosed(changeSet.id),
    });
    expect(first.approved).toBe(true);

    // A second ChangeSet with the SAME digest, attacked with the spent token.
    const envelope2 = buildAuthorizationEnvelope({ id: randomUUID(), canonicalHash: digest });
    deps.envelopes.put(envelope2);
    const changeSet2 = buildChangeSet({
      id: randomUUID(),
      state: "awaiting_approval",
      authorizationEnvelopeId: envelope2.id,
      intentContractId: contract.id,
    });
    deps.changeSets.put(changeSet2);

    const replay = await completeEnvelopeApproval(changeSet2, digest, minted.token, {
      ...deps,
      stageCompletions: designGateClosed(changeSet2.id),
    });
    expect(replay.approved).toBe(false);
  });
});
