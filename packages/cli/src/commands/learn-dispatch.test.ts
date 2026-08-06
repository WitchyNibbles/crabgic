/**
 * `dispatchCommand`'s conditional routing for `learn list|approve|reject|rollback`
 * (roadmap/22-learning-system.md) — when `deps.learning` IS supplied, these four
 * commands hit the real `../learning/learn-command-backend.ts` rather than
 * `NOT_IMPLEMENTED`.
 *
 * WHY THIS FILE EXISTS, measured rather than asserted. At `c0b3873` there was no
 * `learn-dispatch.test.ts` at all, so `./dispatch.ts:111-126`'s four wired branches
 * were executed by no test: `./cli.commands.schema.test.ts` supplies no
 * `deps.learning`, so its four `learn-*` rows take the stub arm, and
 * `../learning/learn-command-backend.test.ts` calls the `runLearn*` functions
 * DIRECTLY, never through the dispatcher. Replacing each of the four ternaries
 * with an unconditional `notImplementedResult(...)` — i.e. un-wiring the verb
 * exactly as the shipped CLI would experience it — left `packages/cli` +
 * `packages/learning` fully green at **119 files / 1398 tests**, once per verb.
 * That green run is the criterion's redness.
 *
 * ⚠️ A NOTE FOR ANYONE REPEATING THE PROBE. Inverting the CONDITION instead
 * (`deps.learning !== undefined` -> `=== undefined`) is NOT the right mutation and
 * does not stay green: it also breaks the UNWIRED direction, so
 * `./cli.commands.schema.test.ts`'s NOT_IMPLEMENTED stub row for that verb reds
 * (1 failed / 1397 passed, measured, once per verb). That row is a real,
 * pre-existing control — it just controls the other direction. Only the
 * un-wiring mutation isolates the arm this file covers.
 *
 * This mirrors phase 12's `./trust-dispatch.test.ts` exactly, including its
 * control shape: `./cli.commands.schema.test.ts`'s stub rows stay untouched and
 * remain truthful (without `deps.learning` the verbs really are NOT_IMPLEMENTED),
 * and the final case here re-asserts that half directly so the two cannot drift
 * apart unnoticed.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createJournalStore } from "@crabgic/journal";
import { ProposalRegistry } from "@crabgic/learning";
import { ApprovalTokenMinter } from "../approval/token.js";
import type { ApprovalPromptIo } from "../approval/prompt.js";
import type { LearningDependencies } from "../learning/learning-dependencies.js";
import { EXIT_GENERAL_ERROR, EXIT_NOT_IMPLEMENTED, EXIT_OK } from "../exit-codes.js";
import { dispatchCommand } from "./dispatch.js";
import type { CliDependencies } from "./types.js";

const changeSetRefs = {
  intentContractId: "11111111-1111-4111-8111-111111111111",
  authorizationEnvelopeId: "22222222-2222-4222-8222-222222222222",
  capabilityManifestId: "33333333-3333-4333-8333-333333333333",
  provisionalPerformanceContractId: "44444444-4444-4444-8444-444444444444",
};

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function baseDeps(): CliDependencies {
  return {
    connectClient: () => {
      throw new Error("not needed for this test");
    },
    journal: {
      queryEntries: async function* () {
        /* no entries */
      },
      verifyJournal: async () => ({ ok: true, entries: 0 }) as never,
    } as unknown as CliDependencies["journal"],
    projectHash: "test-hash",
  };
}

/**
 * The real dependency bag, built exactly as
 * `../learning/learn-command-backend.test.ts:31-48` builds it — a tmp-dir
 * `ProposalRegistry`, a real `createJournalStore`, and one `randomBytes(32)`
 * key shared by the minter and `verifyApprovalTokenDurable`.
 */
async function newLearningDeps(io?: ApprovalPromptIo): Promise<LearningDependencies> {
  const root = await mkdtemp(join(tmpdir(), "eo-learn-dispatch-"));
  dirs.push(root);
  const journal = createJournalStore({ journalDir: join(root, "journal") });
  const sharedKey = randomBytes(32);
  return {
    registry: new ProposalRegistry({ registryDir: join(root, "registry"), journal }),
    journal,
    minter: new ApprovalTokenMinter({ secretKey: sharedKey, journal }),
    secretKey: sharedKey,
    resolveChangeSetRefs: () => changeSetRefs,
    ...(io !== undefined ? { io } : {}),
  };
}

/** Microtask-driven terminal confirmation — no timers, no wall-clock hold. */
function yesIo(): ApprovalPromptIo {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  queueMicrotask(() => input.write("yes\n"));
  return { input, output };
}

async function advanceToIndependentReview(
  learning: LearningDependencies,
  proposalId: string,
): Promise<void> {
  for (const to of [
    "reproducer",
    "candidate",
    "dev_eval",
    "held_out_eval",
    "shadow_run",
    "independent_review",
  ] as const) {
    await learning.registry.transition(proposalId, to);
  }
}

describe("dispatchCommand — learn list|approve|reject|rollback, real backend when deps.learning is supplied", () => {
  it("routes `learn list` to the real backend instead of NOT_IMPLEMENTED", async () => {
    const result = await dispatchCommand(
      { command: "learn-list", json: false },
      { ...baseDeps(), learning: await newLearningDeps() },
    );

    expect(result.exitCode).toBe(EXIT_OK);
    // The real backend's own empty-registry wording — the stub can never say
    // this, and the opposite outcome (a NOT_IMPLEMENTED payload) does not
    // contain it either.
    expect(result.stdout).toContain("no learning proposals");
    expect(result.stdout).not.toContain("NOT_IMPLEMENTED");
  });

  it("routes `learn approve` to the real backend, which fails closed on an unknown id", async () => {
    const result = await dispatchCommand(
      { command: "learn-approve", proposalId: "nope", json: false },
      { ...baseDeps(), learning: await newLearningDeps() },
    );

    // A BACKEND verdict: the stub can only ever produce EXIT_NOT_IMPLEMENTED
    // on stdout, never a diagnostic naming the id on stderr.
    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).toContain('unknown proposal "nope"');
  });

  it("routes `learn approve` through the full prompt -> mint -> record path (1-of-2 shape)", async () => {
    const learning = await newLearningDeps(yesIo());
    const proposal = await learning.registry.create({ content: "lesson" });
    await advanceToIndependentReview(learning, proposal.id);

    const result = await dispatchCommand(
      { command: "learn-approve", proposalId: proposal.id, json: true },
      { ...baseDeps(), learning },
    );

    expect(result.exitCode).toBe(EXIT_OK);
    expect(JSON.parse(result.stdout!)).toEqual({ promoted: false, distinctApprovals: 1 });
    // One approval must NOT promote — the two-distinct-token bar is reached
    // through the dispatcher just as it is through the backend directly.
    expect((await learning.registry.get(proposal.id))?.state).toBe("independent_review");
  });

  it("routes `learn reject` to the real backend, which really transitions the proposal", async () => {
    const learning = await newLearningDeps();
    const proposal = await learning.registry.create({ content: "lesson" });

    const result = await dispatchCommand(
      { command: "learn-reject", proposalId: proposal.id, json: true },
      { ...baseDeps(), learning },
    );

    expect(result.exitCode).toBe(EXIT_OK);
    expect(JSON.parse(result.stdout!)).toMatchObject({
      rejected: true,
      proposal: { id: proposal.id, state: "rejected" },
    });
    expect((await learning.registry.get(proposal.id))?.state).toBe("rejected");
  });

  it("routes `learn rollback` to the real backend, which fails closed on an unknown id", async () => {
    const result = await dispatchCommand(
      { command: "learn-rollback", proposalId: "nope", json: false },
      { ...baseDeps(), learning: await newLearningDeps() },
    );

    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).toContain('unknown proposal "nope"');
  });

  it("CONTROL: still returns the typed NOT_IMPLEMENTED shape for all four when deps.learning is absent", async () => {
    for (const command of [
      { command: "learn-list", json: true },
      { command: "learn-approve", proposalId: "p", json: true },
      { command: "learn-reject", proposalId: "p", json: true },
      { command: "learn-rollback", proposalId: "p", json: true },
    ] as const) {
      const result = await dispatchCommand(command, baseDeps());
      expect(result.exitCode).toBe(EXIT_NOT_IMPLEMENTED);
      const parsed = JSON.parse(result.stdout!) as { status: string; command: string };
      expect(parsed.status).toBe("NOT_IMPLEMENTED");
      expect(parsed.command).toBe(command.command);
    }
  });
});
