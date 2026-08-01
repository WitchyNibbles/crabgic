/**
 * roadmap/24 exit criterion 6: "Rollback to a previously-approved criteria
 * set after re-approval is blocked by latest-seal-wins (integration test)."
 *
 * WHY THIS IS NOT COVERED BY ITS NEIGHBOURS: `@crabgic/journal`'s
 * `criteria-seal-anchor.test.ts` proves `findLatestCriteriaSeal` returns the
 * LATEST of two seals — but that is a unit test of the anchor's read order,
 * with no dispatch, no worker, and no refusal. `./executor.test.ts`'s tamper
 * fixture proves a dispatch refuses a mismatching seal — but it hands
 * `dispatchAttempt` a single, inline-constructed seal object and never reads
 * the journal at all. Neither composes the two, so nothing proved that a
 * ROLLBACK — completing against criteria that really were approved, just not
 * most recently — is refused end-to-end.
 *
 * The composition matters because it is the read path production uses:
 * `@crabgic/cli`'s `run-dispatcher.ts` resolves `approvalSeal` via
 * `findLatestCriteriaSeal(journal, changeSetId)` and threads it into
 * `dispatchAttempt`/`resumeAttempt`. A first-writer-wins anchor would pass
 * every test in this file's neighbours and still let the rollback through.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createJournalStore,
  findLatestCriteriaSeal,
  getLatestAttempt,
  journalCriteriaSeal,
  type JournalStore,
} from "@crabgic/journal";
import {
  buildFakeEngineScript,
  buildRequirement,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
} from "@crabgic/testkit";
import type { Requirement } from "@crabgic/contracts";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "./test-support/minimal-compiled-profile.js";
import { dispatchAttempt } from "./executor.js";

const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const REQ_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const WORK_UNIT_ID = "11111111-1111-4111-8111-111111111111";

/** Revision A: the criteria approved first, then superseded. */
const REV_A: readonly string[] = ["The login form submits"];
/** Revision B: the amended criteria the ChangeSet was RE-approved against. */
const REV_B: readonly string[] = ["The login form submits", "and it rejects an empty password"];

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-scheduler-criteria-rollback-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

/** Both revisions are SELF-CONSISTENT — `buildRequirement` re-derives the hash — so only the journal can tell them apart. */
function revision(acceptanceCriteria: readonly string[]): Requirement {
  return buildRequirement({ id: REQ_ID, acceptanceCriteria: [...acceptanceCriteria] });
}

function succeedingAdapter(): FakeEngineAdapter {
  return new FakeEngineAdapter(
    buildFakeEngineScript({ structuredOutput: buildWorkerResult({ outcome: "succeeded" }) }),
  );
}

/**
 * The journal effect of approve -> material amendment (demote) -> re-approve:
 * two seals for the same ChangeSet, appended in that order.
 */
async function sealTwice(revA: Requirement, revB: Requirement): Promise<void> {
  await journalCriteriaSeal(store, {
    changeSetId: CHANGE_SET_ID,
    criteriaHashes: { [REQ_ID]: revA.criteriaHash },
  });
  await journalCriteriaSeal(store, {
    changeSetId: CHANGE_SET_ID,
    criteriaHashes: { [REQ_ID]: revB.criteriaHash },
  });
}

/** The rationale of every `criteria_seal_refused` adjudication this journal recorded. */
async function refusalRationales(): Promise<readonly string[]> {
  const found: string[] = [];
  for await (const entry of store.queryEntries({ type: "adjudication_decision" })) {
    if (entry.type !== "adjudication_decision") continue;
    if (entry.payload.decision !== "criteria_seal_refused") continue;
    found.push(entry.payload.rationale);
  }
  return found;
}

describe("latest-seal-wins blocks a rollback to a previously-approved criteria set (roadmap/24 exit criterion 6)", () => {
  it("refuses a success judged against the SUPERSEDED revision, resolving the seal through findLatestCriteriaSeal", async () => {
    const revA = revision(REV_A);
    const revB = revision(REV_B);
    expect(revA.criteriaHash).not.toBe(revB.criteriaHash);
    await sealTwice(revA, revB);

    // The dispatcher's own read path — `@crabgic/cli`'s `run-dispatcher.ts`
    // resolves the bar exactly this way, so what this test judges against is
    // what production judges against.
    const approvalSeal = await findLatestCriteriaSeal(store, CHANGE_SET_ID);
    expect(approvalSeal?.criteriaHashes[REQ_ID]).toBe(revB.criteriaHash);

    // The rollback: the work unit presents revision A — genuinely approved
    // once, self-consistent, and no longer the bar in force.
    const outcome = await dispatchAttempt({
      adapter: succeedingAdapter(),
      journal: store,
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
      criteriaSeal: { requirements: [revA], approvalSeal },
    });

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("unreachable");
    expect(outcome.diagnostics.join(" ")).toContain("approval_seal_mismatch");

    // Never `succeeded`, and the typed reason is durable (exit criterion 5's
    // journaling, exercised here through the rollback shape).
    expect((await getLatestAttempt(store, WORK_UNIT_ID))?.status).toBe("failed");
    const rationales = await refusalRationales();
    expect(rationales).toHaveLength(1);
    expect(rationales[0]).toContain("approval_seal_mismatch");
    expect(rationales[0]).toContain(REQ_ID);
    // Ids and hashes only — the criteria text of neither revision leaks.
    expect(rationales[0]).not.toContain("rejects an empty password");
  });

  it("accepts the same work unit judged against the CURRENT revision — re-approval supersedes, it does not brand every later completion a tamper", async () => {
    const revA = revision(REV_A);
    const revB = revision(REV_B);
    await sealTwice(revA, revB);

    const outcome = await dispatchAttempt({
      adapter: succeedingAdapter(),
      journal: store,
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
      criteriaSeal: {
        requirements: [revB],
        approvalSeal: await findLatestCriteriaSeal(store, CHANGE_SET_ID),
      },
    });

    expect(outcome.kind).toBe("succeeded");
    expect((await getLatestAttempt(store, WORK_UNIT_ID))?.status).toBe("succeeded");
    expect(await refusalRationales()).toHaveLength(0);
  });

  it("the FIRST approval alone still accepts revision A — the refusal above is superseding, not an artefact of the fixture", async () => {
    const revA = revision(REV_A);
    await journalCriteriaSeal(store, {
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { [REQ_ID]: revA.criteriaHash },
    });

    const outcome = await dispatchAttempt({
      adapter: succeedingAdapter(),
      journal: store,
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
      criteriaSeal: {
        requirements: [revA],
        approvalSeal: await findLatestCriteriaSeal(store, CHANGE_SET_ID),
      },
    });

    expect(outcome.kind).toBe("succeeded");
  });
});
