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

/**
 * ORDER THE BUILD, OR THE RED HALF IS EARNED BY A MISSING `dist/` (2026-09-05).
 *
 * Found chasing run `aff03e3a`. Workspace packages here resolve through
 * `main: ./dist/index.js`, `dist/` is gitignored, and `git worktree add`
 * materialises none of it — so the first cross-package `import` in a fresh
 * worktree fails with `ERR_MODULE_NOT_FOUND` and the suite exits non-zero
 * having run no test at all. `worktree-dependencies.ts` documents exactly this
 * ("Nothing currently orders that build first... it belongs to the scheduler's
 * ordering rather than to this module") and nothing ordered it.
 *
 * The cost is not a failed run, it is a FABRICATED one: a non-zero status from
 * an unbuilt tree is indistinguishable from a failing test, so the red half of
 * red-before-green — the strongest evidence this system mints — was earned by
 * an absent build output. That is the same class of defect `didNotRun` exists
 * to refuse, arriving one layer lower.
 *
 * The build command is not invented here either. It is the envelope's own
 * `integrity`-class grant, already compiled into the worker's profile, so
 * running it takes no authority the owner did not give.
 */

/** A real worktree whose `build` and `test` scripts are whatever the caller needs. */
async function makeScriptedWorktree(scripts: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "crabgic-tdd-integrity-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "fixture", private: true, scripts }),
    "utf8",
  );
  return dir;
}

describe("selectIntegrityCommand", () => {
  it("selects the integrity-class grant and never the acceptance one", async () => {
    const { selectIntegrityCommand } = await import("./tdd-baseline.js");
    expect(selectIntegrityCommand(["npm run test", "npm run build"])).toBe("npm run build");
    expect(selectIntegrityCommand(["npm run build", "npm run test"])).toBe("npm run build");
  });

  it("returns undefined when the envelope grants no integrity command", async () => {
    const { selectIntegrityCommand } = await import("./tdd-baseline.js");
    expect(selectIntegrityCommand(["npm run test"])).toBeUndefined();
    expect(selectIntegrityCommand([])).toBeUndefined();
  });

  /**
   * The envelope's own string, never the matched prefix — the same rule
   * `selectAcceptanceCommand` states: the compiled profile emits
   * `Bash(<prefix>:*)`, so substituting the bare prefix would run a DIFFERENT
   * command from the one the owner approved.
   */
  it("returns the granted string verbatim, not the prefix it matched", async () => {
    const { selectIntegrityCommand } = await import("./tdd-baseline.js");
    expect(selectIntegrityCommand(["npm run build:workspaces"])).toBe("npm run build:workspaces");
  });

  it("ignores a string matching no grantable prefix, so a policy typo is never executed", async () => {
    const { selectIntegrityCommand } = await import("./tdd-baseline.js");
    expect(selectIntegrityCommand(["npm run buidl"])).toBeUndefined();
  });
});

describe("captureTddBaseline — the granted build runs BEFORE the granted test", () => {
  /**
   * The ordering is proven by execution, not by a spy: `test` exits 1 only if
   * `build` already wrote its marker. A run that skips the build sees no
   * marker, exits 0, and is `notRed` — which is exactly what this returned
   * before the build was ordered.
   */
  it("captures red only because the build ran first", async () => {
    worktree = await makeScriptedWorktree({
      build: `node -e "require('fs').writeFileSync('built.txt','1')"`,
      test: `node -e "process.exit(require('fs').existsSync('built.txt') ? 1 : 0)"`,
    });
    const outcome = await captureTddBaseline({
      ...baseInput(),
      worktreePath: worktree,
      grantedCommands: ["npm run test", "npm run build"],
    });
    expect(outcome.kind).toBe("captured");
  });

  /**
   * ⚠️ A FAILED BUILD MINTS NOTHING. The suite would exit non-zero for a reason
   * that has nothing to do with any test, so treating it as red would fabricate
   * the baseline this whole module exists to make honest.
   */
  it("refuses to mint a baseline when the granted build fails", async () => {
    worktree = await makeScriptedWorktree({ build: "exit 3", test: "exit 1" });
    const outcome = await captureTddBaseline({
      ...baseInput(),
      worktreePath: worktree,
      grantedCommands: ["npm run test", "npm run build"],
    });
    expect(outcome.kind).toBe("integrityFailed");
    if (outcome.kind === "integrityFailed") {
      expect(outcome.command).toBe("npm run build");
      expect(outcome.exitStatus).toBe(3);
    }
    expect(await hasRedBaseline(tj.store, REQUIREMENT_ID)).toBe(false);
  });

  /** No integrity grant means no build to order — unchanged behaviour, pinned so the fix cannot widen. */
  it("runs the test command alone when the envelope grants no build", async () => {
    worktree = await makeScriptedWorktree({ build: "exit 3", test: "exit 1" });
    const outcome = await captureTddBaseline({
      ...baseInput(),
      worktreePath: worktree,
      grantedCommands: ["npm run test"],
    });
    expect(outcome.kind).toBe("captured");
  });
});

/**
 * A BUILD THAT NEVER COMPLETED IS NOT A BUILD THAT SUCCEEDED (2026-09-05,
 * found by adversarial review of the commit that ordered the build).
 *
 * The first version of the ordering guarded on `build.ran && exitStatus !== 0`,
 * which reads "a build that RAN and failed refuses". A build killed on the
 * timeout, or one that could not be spawned at all, reports `ran: false` — so
 * it fell straight through to the acceptance command in a tree that was never
 * built, and minted exactly the fabricated red baseline the ordering exists to
 * prevent. The bug was the same shape as the one being fixed, one branch over.
 *
 * The guard is therefore on SELECTION, not on completion: if the envelope
 * granted a build, that build must have completed successfully before any test
 * result from this tree means anything.
 */
describe("captureTddBaseline — a granted build that did not complete refuses too", () => {
  it("refuses when the granted build is killed on the timeout", async () => {
    worktree = await makeScriptedWorktree({
      build: `node -e "setTimeout(()=>{},60000)"`,
      test: "exit 1",
    });
    const outcome = await captureTddBaseline({
      ...baseInput(),
      worktreePath: worktree,
      grantedCommands: ["npm run test", "npm run build"],
      timeoutMs: 300,
    });
    expect(outcome.kind).toBe("integrityDidNotRun");
    expect(await hasRedBaseline(tj.store, REQUIREMENT_ID)).toBe(false);
  });

  /**
   * ⚠️ DISTINCT FROM `integrityFailed`, because the repairs differ: a failed
   * build is a broken tree, an incomplete one is a budget or a host problem.
   * Folding them would tell an operator to go read a build log that does not
   * exist.
   */
  it("distinguishes a build that did not complete from one that failed", async () => {
    worktree = await makeScriptedWorktree({ build: "exit 3", test: "exit 1" });
    const failed = await captureTddBaseline({
      ...baseInput(),
      worktreePath: worktree,
      grantedCommands: ["npm run test", "npm run build"],
    });
    expect(failed.kind).toBe("integrityFailed");
  });
});
