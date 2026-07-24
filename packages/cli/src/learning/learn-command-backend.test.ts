import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { ProposalRegistry } from "@eo/learning";
import { ApprovalTokenMinter } from "../approval/token.js";
import type { ApprovalPromptIo } from "../approval/prompt.js";
import type { LearningDependencies } from "./learning-dependencies.js";
import {
  runLearnApproveCommand,
  runLearnListCommand,
  runLearnRejectCommand,
  runLearnRollbackCommand,
} from "./learn-command-backend.js";

const changeSetRefs = {
  intentContractId: "11111111-1111-4111-8111-111111111111",
  authorizationEnvelopeId: "22222222-2222-4222-8222-222222222222",
  capabilityManifestId: "33333333-3333-4333-8333-333333333333",
  provisionalPerformanceContractId: "44444444-4444-4444-8444-444444444444",
};

let root: string;
let journal: JournalStore;
let registry: ProposalRegistry;
let deps: LearningDependencies;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-cli-learn-backend-"));
  journal = createJournalStore({ journalDir: join(root, "journal") });
  registry = new ProposalRegistry({ registryDir: join(root, "registry"), journal });
  // NOTE: `minter` and `verifyApprovalTokenDurable` (called with
  // `deps.secretKey`) must share the SAME secret key — see
  // `runLearnApproveCommand`'s own reuse of `deps.secretKey` for both.
  const sharedKey = randomBytes(32);
  deps = {
    registry,
    journal,
    minter: new ApprovalTokenMinter({ secretKey: sharedKey, journal }),
    secretKey: sharedKey,
    changeSetRefs,
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function yesIo(): ApprovalPromptIo & { chunks: string[] } {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
  queueMicrotask(() => input.write("yes\n"));
  return { input, output, chunks };
}

function noIo(): ApprovalPromptIo {
  const input = new PassThrough();
  const output = new PassThrough();
  queueMicrotask(() => input.write("no\n"));
  return { input, output };
}

async function advanceToIndependentReview(proposalId: string): Promise<void> {
  await registry.transition(proposalId, "reproducer");
  await registry.transition(proposalId, "candidate");
  await registry.transition(proposalId, "dev_eval");
  await registry.transition(proposalId, "held_out_eval");
  await registry.transition(proposalId, "shadow_run");
  await registry.transition(proposalId, "independent_review");
}

describe("runLearnListCommand", () => {
  it("reports no proposals when the registry is empty", async () => {
    const result = await runLearnListCommand({ command: "learn-list", json: false }, deps);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("no learning proposals");
  });

  it("lists proposals with state and content, --json included", async () => {
    const proposal = await registry.create({ content: "always re-check X" });
    const result = await runLearnListCommand({ command: "learn-list", json: true }, deps);
    expect(JSON.parse(result.stdout!)).toMatchObject({
      proposals: [{ id: proposal.id, state: "observation" }],
    });

    const human = await runLearnListCommand({ command: "learn-list", json: false }, deps);
    expect(human.stdout).toContain(proposal.id);
    expect(human.stdout).toContain("observation");
  });
});

describe("runLearnApproveCommand", () => {
  it("fails closed for an unknown proposal id", async () => {
    const result = await runLearnApproveCommand(
      { command: "learn-approve", proposalId: "unknown-id", json: false },
      deps,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown proposal");
  });

  it("refuses a proposal not yet in independent_review", async () => {
    const proposal = await registry.create({ content: "lesson" });
    const result = await runLearnApproveCommand(
      { command: "learn-approve", proposalId: proposal.id, json: false },
      deps,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not awaiting independent review");
  });

  it("records exactly one approval and does NOT promote after a single 'learn approve' call", async () => {
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);

    const result = await runLearnApproveCommand(
      { command: "learn-approve", proposalId: proposal.id, json: false },
      { ...deps, io: yesIo() },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("awaiting at least one more DISTINCT reviewer");
    expect((await registry.get(proposal.id))?.state).toBe("independent_review");
  });

  it("promotes on the SECOND distinct 'learn approve' call — two real, distinct tokens, journaled", async () => {
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);

    const first = await runLearnApproveCommand(
      { command: "learn-approve", proposalId: proposal.id, json: false },
      { ...deps, io: yesIo() },
    );
    expect(first.exitCode).toBe(0);

    const second = await runLearnApproveCommand(
      { command: "learn-approve", proposalId: proposal.id, json: true },
      { ...deps, io: yesIo() },
    );
    expect(second.exitCode).toBe(0);
    const parsed = JSON.parse(second.stdout!) as { promoted: boolean; changeSet: { id: string } };
    expect(parsed.promoted).toBe(true);
    expect(typeof parsed.changeSet.id).toBe("string");

    expect((await registry.get(proposal.id))?.state).toBe("promoted");

    const approvals = await registry.getReviewApprovals(proposal.id);
    expect(new Set(approvals.map((a) => a.tokenId)).size).toBe(2);

    // learning_transition to "promoted" is journaled.
    const entries: { payload: { to: string } }[] = [];
    for await (const entry of journal.queryEntries({
      type: "learning_transition",
      workUnitId: proposal.id,
    })) {
      entries.push(entry as { payload: { to: string } });
    }
    expect(entries.some((e) => e.payload.to === "promoted")).toBe(true);

    // approval_token_mint was journaled twice (once per real mint).
    const mints: unknown[] = [];
    for await (const entry of journal.queryEntries({ type: "approval_token_mint" })) {
      mints.push(entry);
    }
    expect(mints.length).toBeGreaterThanOrEqual(2);
  });

  it("declining at the terminal prompt mints no token and records no approval", async () => {
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);

    const declineDeps: LearningDependencies = { ...deps, io: noIo() };
    const result = await runLearnApproveCommand(
      { command: "learn-approve", proposalId: proposal.id, json: false },
      declineDeps,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("declined");
    expect(await registry.getReviewApprovals(proposal.id)).toEqual([]);
  });
});

describe("runLearnRejectCommand", () => {
  it("fails closed for an unknown proposal id", async () => {
    const result = await runLearnRejectCommand(
      { command: "learn-reject", proposalId: "unknown-id", json: false },
      deps,
    );
    expect(result.exitCode).not.toBe(0);
  });

  it("rejects a known proposal at any stage", async () => {
    const proposal = await registry.create({ content: "lesson" });
    const result = await runLearnRejectCommand(
      { command: "learn-reject", proposalId: proposal.id, json: false },
      deps,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("rejected");
    expect((await registry.get(proposal.id))?.state).toBe("rejected");
  });

  it("--json reports the rejected proposal", async () => {
    const proposal = await registry.create({ content: "lesson" });
    const result = await runLearnRejectCommand(
      { command: "learn-reject", proposalId: proposal.id, json: true },
      deps,
    );
    expect(JSON.parse(result.stdout!)).toMatchObject({
      rejected: true,
      proposal: { state: "rejected" },
    });
  });
});

describe("runLearnRollbackCommand", () => {
  it("fails closed for an unknown proposal id", async () => {
    const result = await runLearnRollbackCommand(
      { command: "learn-rollback", proposalId: "unknown-id", json: false },
      deps,
    );
    expect(result.exitCode).not.toBe(0);
  });

  it("refuses rollback on a proposal that was never promoted", async () => {
    const proposal = await registry.create({ content: "lesson" });
    const result = await runLearnRollbackCommand(
      { command: "learn-rollback", proposalId: proposal.id, json: false },
      deps,
    );
    expect(result.exitCode).not.toBe(0);
  });

  it("rolls back a fully-promoted proposal end-to-end via two real 'learn approve' calls", async () => {
    const proposal = await registry.create({ content: "lesson" });
    await advanceToIndependentReview(proposal.id);
    await runLearnApproveCommand(
      { command: "learn-approve", proposalId: proposal.id, json: false },
      { ...deps, io: yesIo() },
    );
    const promote = await runLearnApproveCommand(
      { command: "learn-approve", proposalId: proposal.id, json: true },
      { ...deps, io: yesIo() },
    );
    const { changeSet } = JSON.parse(promote.stdout!) as { changeSet: { id: string } };

    const rollback = await runLearnRollbackCommand(
      { command: "learn-rollback", proposalId: proposal.id, json: true },
      deps,
    );
    expect(rollback.exitCode).toBe(0);
    const parsed = JSON.parse(rollback.stdout!) as {
      rolledBack: boolean;
      inverseChangeSet: { rollbackStrategy: string };
    };
    expect(parsed.rolledBack).toBe(true);
    expect(parsed.inverseChangeSet.rollbackStrategy).toContain(changeSet.id);
    expect((await registry.get(proposal.id))?.state).toBe("rolled_back");
  });
});
