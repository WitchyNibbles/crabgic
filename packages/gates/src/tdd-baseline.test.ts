import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureTddBaseline } from "./tdd-baseline.js";
import { hasRedBaseline } from "./tdd-gate.js";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";

/**
 * ⚠️ THE PRODUCER THAT WAS NEVER THERE — owner decision 2026-08-18, "harness
 * runs it pre-dispatch".
 *
 * `createTddGate` reads a red-baseline `EvidenceRecord` out of the journal and
 * `captureRedBaseline` is the only thing that writes one. MEASURED before this
 * module existed: `captureRedBaseline` had **zero** production call sites and
 * the scheduler journals no `evidence_pointer` entry of any kind, so the
 * red half of the red-before-green pair could not exist in any real run. That
 * is why `implement-tests-first` is underivable for every change set
 * (`packages/cli/src/review/gate-criteria.ts` refuses to presume a missing
 * verdict green) and why owner ruling R7's staged run stopped at stage 6 of 9.
 *
 * THE COMMAND IS NOT INVENTED HERE. It comes from the run's approved
 * `AuthorizationEnvelope.commands`, filtered to the members
 * `classifyGrantedCommand` puts in the `acceptance` class
 * (`@crabgic/contracts`' `COMMAND_EVIDENCE_CLASS`). Running anything else would
 * be the harness taking authority the owner did not grant — the one refusal
 * reason the operating protocol names as "expanded authority".
 *
 * NO INJECTED RUNNER, DELIBERATELY. These tests execute the real command in a
 * real temporary directory through the real child-process path. A `runCommand`
 * seam would let every arm below pass against a module that never spawns
 * anything, which is the harness-only reach
 * `docs/evidence/criteria-closeout/defects/14-gate-registry-never-composed.md`
 * documents and this module exists to end.
 */

const CHANGE_SET_ID = "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const WORK_UNIT_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const REQUIREMENT_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const OTHER_REQUIREMENT_ID = "4d5e6f7a-8b9c-4d0e-8f1a-2b3c4d5e6f7a";
const BASE_OBJECT_ID = "0123456789abcdef0123456789abcdef01234567";

let tj: TestJournal;
let worktree: string;

/** A real directory carrying a real `package.json` whose `test` script exits with `code`. */
async function makeWorktree(code: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "crabgic-tdd-baseline-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "fixture", private: true, scripts: { test: `exit ${code}` } }),
    "utf8",
  );
  return dir;
}

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
  if (worktree !== undefined) await rm(worktree, { recursive: true, force: true });
});

function baseInput(): Parameters<typeof captureTddBaseline>[0] {
  return {
    journal: tj.store,
    changeSetId: CHANGE_SET_ID,
    workUnitId: WORK_UNIT_ID,
    requirementIds: [REQUIREMENT_ID],
    baseObjectId: BASE_OBJECT_ID,
    worktreePath: worktree,
    grantedCommands: ["npm run test"],
    now: () => new Date("2026-08-18T16:00:00.000Z"),
  };
}

describe("captureTddBaseline — the harness runs the granted test command before dispatch", () => {
  /**
   * The whole point, end to end: a real failing suite at base leaves a real red
   * `EvidenceRecord` in the journal, and `hasRedBaseline` — the exact predicate
   * `createTddGate` calls — can find it. Asserting through `hasRedBaseline`
   * rather than by re-reading the entry is what makes this a wire test rather
   * than two constructions of the same literal.
   */
  it("journals a red baseline the TDD gate's own predicate can find, when the granted command fails", async () => {
    worktree = await makeWorktree(1);

    const outcome = await captureTddBaseline(baseInput());

    expect(outcome.kind).toBe("captured");
    expect(await hasRedBaseline(tj.store, REQUIREMENT_ID)).toBe(true);
  }, 60_000);

  /**
   * ⚠️ The anti-fabrication arm. A green suite at base proves nothing about a
   * test's ability to catch a regression, so there is NO baseline to journal —
   * and the module must say so rather than manufacturing one. Without this arm
   * an implementation that always captured would pass every other assertion
   * here, and the TDD gate would be satisfied by a run that never wrote a
   * failing test at all.
   */
  it("journals NOTHING when the granted command already passes at base", async () => {
    worktree = await makeWorktree(0);

    const outcome = await captureTddBaseline(baseInput());

    expect(outcome.kind).toBe("notRed");
    expect(await hasRedBaseline(tj.store, REQUIREMENT_ID)).toBe(false);
  }, 60_000);

  /**
   * Requirement scoping, because the gate is requirement-scoped: a unit
   * declaring two requirements gets a baseline for each, and a requirement no
   * unit declared gets none. A single shared record would let one unit's red
   * run satisfy an unrelated requirement's gate.
   */
  it("captures one baseline per declared requirement, and none for an undeclared one", async () => {
    worktree = await makeWorktree(1);

    await captureTddBaseline({
      ...baseInput(),
      requirementIds: [REQUIREMENT_ID, OTHER_REQUIREMENT_ID],
    });

    expect(await hasRedBaseline(tj.store, REQUIREMENT_ID)).toBe(true);
    expect(await hasRedBaseline(tj.store, OTHER_REQUIREMENT_ID)).toBe(true);
    expect(await hasRedBaseline(tj.store, "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b")).toBe(false);
  }, 60_000);

  /**
   * ⚠️ Expanded authority is a refusal, not a default. An envelope granting no
   * `acceptance`-class command authorizes no test run, so the harness runs
   * nothing and captures nothing — the gate then fails closed at `verifying`,
   * which is the correct direction. The alternative, reaching for a
   * conventional `npm test`, would be the harness executing a command the
   * owner never approved.
   */
  it("REFUSES to run anything when the envelope grants no acceptance-class command", async () => {
    worktree = await makeWorktree(1);

    const outcome = await captureTddBaseline({
      ...baseInput(),
      // `git status` and `git diff` are granted, and both classify `inspection`.
      grantedCommands: ["git status", "git diff"],
    });

    expect(outcome.kind).toBe("noAcceptanceCommand");
    expect(await hasRedBaseline(tj.store, REQUIREMENT_ID)).toBe(false);
  }, 60_000);

  /**
   * A string that matches no grant at all is not a weaker grant — it is no
   * grant. `classifyGrantedCommand` returns `undefined` for it, and the
   * compiled permission profile discards it silently, so treating it as
   * runnable here would let a policy author's typo become an executed command.
   */
  it("REFUSES a command string that matches no grantable prefix", async () => {
    worktree = await makeWorktree(1);

    const outcome = await captureTddBaseline({
      ...baseInput(),
      grantedCommands: ["npm run lint", "pytest -q"],
    });

    expect(outcome.kind).toBe("noAcceptanceCommand");
    expect(await hasRedBaseline(tj.store, REQUIREMENT_ID)).toBe(false);
  }, 60_000);

  /**
   * The captured record must name the command that actually ran and the exit
   * status it actually produced. Both are what a later reader has to audit the
   * claim with, and a hard-coded pair would make every arm above pass while the
   * evidence described a run that never happened.
   */
  it("records the command that ran and its real non-zero exit status", async () => {
    worktree = await makeWorktree(3);

    const outcome = await captureTddBaseline(baseInput());

    expect(outcome.kind).toBe("captured");
    if (outcome.kind !== "captured") return;
    expect(outcome.command).toBe("npm run test");
    expect(outcome.exitStatus).toBe(3);
    expect(outcome.records).toHaveLength(1);
    expect(outcome.records[0]?.exitStatus).toBe(3);
    expect(outcome.records[0]?.objectId).toBe(BASE_OBJECT_ID);
    expect(outcome.records[0]?.requirementId).toBe(REQUIREMENT_ID);
  }, 60_000);

  /**
   * ⚠️ A COMMAND THAT NEVER STARTED IS NOT A FAILING TEST, and this arm exists
   * because the first implementation got it wrong: it reported the spawn error
   * as exit status `-1`, which is non-zero, which made "the worktree does not
   * exist" indistinguishable from "the suite is red". A mis-provisioned
   * worktree would have minted the strongest evidence this system has. Found by
   * `packages/cli/src/daemon/composed-daemon-seal-enforcement.test.ts`, whose
   * injected worktree path is not a real directory — not by any arm written
   * here, which is why it is written here now.
   */
  it("does NOT mint a baseline when the command could not start at all", async () => {
    worktree = await makeWorktree(1);

    const outcome = await captureTddBaseline({
      ...baseInput(),
      worktreePath: join(worktree, "does-not-exist"),
    });

    expect(outcome.kind).toBe("didNotRun");
    expect(await hasRedBaseline(tj.store, REQUIREMENT_ID)).toBe(false);
  }, 60_000);

  /**
   * A work unit declaring no requirements has no gate to satisfy and nothing to
   * scope a record to. Running the suite for it would be cost with no evidence
   * to show for it.
   */
  it("runs nothing for a work unit declaring no requirements", async () => {
    worktree = await makeWorktree(1);

    const outcome = await captureTddBaseline({ ...baseInput(), requirementIds: [] });

    expect(outcome.kind).toBe("noRequirements");
  }, 60_000);
});
