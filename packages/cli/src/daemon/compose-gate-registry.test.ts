/**
 * What the production gate-registry composition root actually registers — and,
 * just as load-bearing, what it does NOT.
 *
 * The registered-gate list is asserted by DEEP EQUALITY, not `toContain`. That
 * is the pinned residual: registering 14's own gate tranche or 15's performance
 * gate reddens this file and has to be acknowledged, rather than arriving
 * silently beside a doc comment that says they are deferred.
 *
 * Two families are registered as of Batch M — phase 24's criteria-seal gate
 * under `acceptance`, and phase 21's six security fixtures under `security`.
 * The emptiness assertions for `performance`/`tdd`/`coverage`/`flake`/
 * `engine-conformance` are what still pin the UNregistered remainder, and they
 * are as load-bearing as the membership ones.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Requirement, WorkUnit } from "@crabgic/contracts";
import { createJournalStore, journalCriteriaSeal, type JournalStore } from "@crabgic/journal";
import {
  UnresolvedRequirementError,
  createRequirementsRegistry,
  createWorkUnitsRegistry,
  type Registry,
} from "@crabgic/supervisor";
import { REQUIRED_SECURITY_FIXTURE_IDS, hasRedBaseline } from "@crabgic/gates";
import { buildRequirement, buildWorkUnit } from "@crabgic/testkit";
import {
  COMPOSED_GATE_NAMES,
  changeSetRequirementIds,
  composeGateRegistry,
  describeFailedIntegrityCommand,
  type AttemptSurface,
} from "./compose-gate-registry.js";

/**
 * An `AttemptSurface` that can answer nothing — the correct default for tests
 * about composition rather than about the TDD gate. Every member returning
 * `undefined` makes that gate fail closed, which is what an unmeasurable
 * candidate SHOULD produce; a stub that answered would be this test file
 * asserting against a fiction.
 */
const NO_ATTEMPTS: AttemptSurface = {
  worktreePathFor: (): string | undefined => undefined,
  grantedCommandsFor: (): readonly string[] | undefined => undefined,
  diffAgainstBase: (): Promise<string | undefined> => Promise.resolve(undefined),
  withBaseTree: <T>(): Promise<T | undefined> => Promise.resolve(undefined),
};

/**
 * A `withBaseTree` that honours PRODUCTION'S CONTRACT rather than a weaker one
 * of its own: `prepareBaseTree` runs first, on the pristine tree, and a value
 * it returns IS the result — exactly what `withRedBaselineTree` does.
 *
 * ⚠️ WHY THIS IS SHARED AND TYPED, MEASURED. Both call sites used to inline a
 * FOUR-parameter arrow cast `as typeof NO_ATTEMPTS.withBaseTree`, and
 * TypeScript accepts a function of lower arity anywhere a higher-arity one is
 * wanted — so the fifth parameter was silently dropped and the registry's own
 * `prepareBaseTree` closure was executed by no test at all. Deleting that
 * closure, the entire base-tree build, left the suite green at 727 files /
 * 7940 tests. One honouring helper means a test cannot re-declare the seam.
 */
function baseTreeSurface(baseTree: string): Pick<AttemptSurface, "withBaseTree"> {
  return {
    async withBaseTree<T>(
      _changeSetId: string,
      _workUnitId: string,
      _candidateObjectId: string,
      _testPaths: readonly string[],
      use: (worktreePath: string) => Promise<T>,
      prepareBaseTree?: (worktreePath: string) => Promise<T | undefined>,
    ): Promise<T | undefined> {
      const prepared = await prepareBaseTree?.(baseTree);
      if (prepared !== undefined) return prepared;
      return use(baseTree);
    },
  };
}

/**
 * The ceiling these fixtures run their granted commands under.
 *
 * ⚠️ IT BOUNDS THE COMMANDS THAT MUST COMPLETE, TOO, which is what sets the
 * floor. A fixture's `npm run <script>` costs ~90 ms idle on the reference
 * host; under the full suite's worker fan-out that is several times higher,
 * and a ceiling tight enough to catch it turns a passing case into "the base
 * build did not complete" — measured, as an intermittent failure of the
 * candidate-suite case at 300 ms. Three seconds is ~30x the idle cost of the
 * commands that must finish and ~20x under the 60 s sleep the hanging ones
 * use, so it discriminates without racing the host.
 */
const FIXTURE_COMMAND_CEILING_MS = 3_000;

/** A worktree that is nothing but a `package.json` with the named scripts. */
async function scriptedTree(scripts: Record<string, string>): Promise<string> {
  const treeDir = await mkdtemp(join(tmpdir(), "crabgic-candidate-"));
  await writeFile(
    join(treeDir, "package.json"),
    JSON.stringify({ name: "candidate", private: true, scripts }),
    "utf8",
  );
  return treeDir;
}

const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_CHANGE_SET_ID = "33333333-3333-4333-8333-333333333333";
const UNIT_A = "44444444-4444-4444-8444-444444444444";
const UNIT_B = "55555555-5555-4555-8555-555555555555";
const REQ_1 = "66666666-6666-4666-8666-666666666666";
const REQ_2 = "77777777-7777-4777-8777-777777777777";
const OBJECT_ID = "b".repeat(40);

let dir: string;
let journal: JournalStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eo-compose-gates-"));
  journal = createJournalStore({ journalDir: join(dir, "journal") });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

function units(records: readonly WorkUnit[]): Registry<WorkUnit> {
  const registry = createWorkUnitsRegistry();
  for (const record of records) registry.put(record);
  return registry;
}

function requirements(records: readonly Requirement[]): Registry<Requirement> {
  const registry = createRequirementsRegistry();
  for (const record of records) registry.put(record);
  return registry;
}

function unit(id: string, changeSetId: string, requirementIds: readonly string[]): WorkUnit {
  return buildWorkUnit({
    id,
    changeSetId,
    dependsOn: [],
    attemptStatus: "pending",
    requirementIds: [...requirementIds],
  });
}

describe("the registered gate set is pinned", () => {
  /**
   * ⚠️ FLIPPED DELIBERATELY (Batch M). Four assertions in this case pinned the
   * OLD residual — `COMPOSED_GATE_NAMES` being the single literal
   * `["criteria-seal"]`, the tag list being the single literal
   * `["acceptance"]`, and `list("security")` being empty. They were correct
   * then and they were asserting the state this batch exists to change, so they
   * change with disclosure rather than being quietly relaxed.
   *
   * What replaces the literal-constant assertion is NOT a restatement of the
   * constant's own definition — that would be a tautology over a literal, since
   * `COMPOSED_GATE_NAMES` is now derived from `REQUIRED_SECURITY_FIXTURE_IDS`.
   * It is a per-TAG claim about the REGISTRY, which the constant cannot make:
   * exactly one acceptance gate, and the whole security manifest.
   *
   * The `performance`/`tdd`/`coverage`/`flake`/`engine-conformance` emptiness
   * assertions are UNCHANGED and must keep passing — they now pin the remaining
   * residual (15's perf gate and 14's own tranche are still unregistered), and
   * that residual is the one this batch deliberately did not close.
   */
  /**
   * ⚠️ FLIPPED AGAIN (owner ruling R5, 2026-08-16), and disclosed for the same
   * reason the Batch M flip above was. The `acceptance` tag now carries TWO
   * gates, not one, and the ordering claim below changes with it.
   *
   * The two are complementary rather than redundant, which is why the
   * one-acceptance-gate assertion was wrong to keep: `criteria-seal` asks
   * whether the criteria being published against are the criteria that were
   * APPROVED, and `acceptance-evaluated` asks whether they were ever EVALUATED.
   * Both of the runs in `docs/evidence/phase-25/published-unverified.md` passed
   * the first and would fail the second.
   *
   * The emptiness assertions for the deferred tranches are UNCHANGED and still
   * pin the residual R5 does not close.
   */
  it("registers EXACTLY the security-fixture manifest plus both acceptance gates — nothing else", () => {
    const registry = composeGateRegistry({
      attempts: NO_ATTEMPTS,
      projectId: "fixture-project",
      requirements: requirements([]),
      workUnits: units([]),
    });

    // Deep equality: a `toContain` would let a silent addition through. A new
    // gate FAMILY grows `list()` without growing the derived constant, so it
    // reddens here.
    expect(registry.list().map((gate) => gate.name)).toStrictEqual([...COMPOSED_GATE_NAMES]);
    expect(registry.list("acceptance").map((gate) => gate.name)).toStrictEqual([
      "criteria-seal",
      "acceptance-evaluated",
    ]);
    expect(registry.list("security").map((gate) => gate.name)).toStrictEqual([
      ...REQUIRED_SECURITY_FIXTURE_IDS,
    ]);
    expect(new Set(registry.list().map((gate) => gate.tag))).toStrictEqual(
      new Set(["security", "acceptance", "tdd", "coverage"]),
    );
    /**
     * `tdd` JOINED 2026-08-18 and is the only family this constant has grown
     * since. It is registered `perWorkUnit`, so it is the one composed gate
     * `fireAll` skips — asserted here so the marker is pinned at the
     * composition root and not only where it is set.
     */
    expect(registry.list("tdd").map((gate) => gate.name)).toStrictEqual(["tdd-evidence"]);
    expect(registry.list("tdd")[0]?.perWorkUnit).toBe(true);
    /**
     * `coverage` JOINED 2026-08-18, on the same stated exception to the
     * no-stack-command rule: producing a `CoverageSummary` means running the
     * project's own test command, which the harness may now do within the
     * approved envelope. Also `perWorkUnit` — it scores ONE unit's change.
     */
    expect(registry.list("coverage").map((gate) => gate.name)).toStrictEqual([
      "changed-line-coverage",
    ]);
    expect(registry.list("coverage")[0]?.perWorkUnit).toBe(true);
    expect(registry.list("acceptance").every((gate) => !gate.perWorkUnit)).toBe(true);
    expect(registry.list("security").every((gate) => !gate.perWorkUnit)).toBe(true);
    // The deferred tranches are ABSENT, not merely undocumented. `tdd` and
    // `coverage` left this list when the harness gained the ability to run a
    // granted test command; the rest still have no backend to measure with.
    expect(registry.list("performance")).toEqual([]);
    expect(registry.list("flake")).toEqual([]);
    expect(registry.list("engine-conformance")).toEqual([]);
  });
});

/**
 * Phase 21 work item 6 calls the six security fixtures "standing, blocking
 * entries in 14's gate manifest rather than one-off phase-exit tests"
 * (`roadmap/21-connector-evidence-integration.md:21`). Before this suite
 * existed, "standing" was true only inside `packages/gates`' own unit test:
 * `registerSecurityFixtureManifest` had exactly ONE caller in the repository
 * and it was `security-fixture-manifest.test.ts`. These cases are what makes
 * the word true of the shipped daemon.
 */
describe("the security-fixture manifest is registered as a standing, blocking gate set", () => {
  it("registers EVERY manifest entry under the shared `security` tag, named by fixture id", () => {
    const registry = composeGateRegistry({
      attempts: NO_ATTEMPTS,
      projectId: "fixture-project",
      requirements: requirements([]),
      workUnits: units([]),
    });

    expect(registry.list("security").map((gate) => gate.name)).toStrictEqual([
      ...REQUIRED_SECURITY_FIXTURE_IDS,
    ]);
    expect(registry.list("security").map((gate) => gate.tag)).toStrictEqual(
      REQUIRED_SECURITY_FIXTURE_IDS.map(() => "security"),
    );
  });

  it("lists in GATE_RISK_TAGS order, not registration order — the acceptance gates register FIRST and LAST but list together, last", () => {
    const registry = composeGateRegistry({
      attempts: NO_ATTEMPTS,
      projectId: "fixture-project",
      requirements: requirements([]),
      workUnits: units([]),
    });

    // This is what makes `COMPOSED_GATE_NAMES`' own ordering correct, and it is
    // a claim about `@crabgic/gates`' `list()` rather than about this file's
    // constant: `registry.list()` flattens the tag map in `GATE_RISK_TAGS`
    // order (`packages/gates/src/risk-tags.ts:28`), and that vocabulary opens
    // by spreading `INTENT_CONTRACT_SECTION_KEYS`
    // (`packages/contracts/src/contracts/intent-contract.ts:16`), which lists
    // `security` fifth and `acceptance` ninth. Re-ordering either list reddens
    // here even though every gate is still registered.
    //
    // R5 makes this sharper rather than weaker: `acceptance-evaluated`
    // registers LAST of all and still lists inside the `acceptance` block,
    // beside a gate registered first — so this asserts the tag grouping, not an
    // insertion order that happens to agree with it.
    //
    // `tdd` is index 9 in `GATE_RISK_TAGS` — after all nine section keys — so
    // it lists LAST of all, behind the `acceptance` block, even though it
    // registers before `acceptance-evaluated`. That is a second, independent
    // witness to the same claim.
    const names = registry.list().map((gate) => gate.name);
    // `tdd` is index 9 and `coverage` index 10, both after all nine section
    // keys — so they list LAST, in that order, behind the `acceptance` block.
    expect(names.slice(-2)).toStrictEqual(["tdd-evidence", "changed-line-coverage"]);
    expect(names.slice(-4, -2)).toStrictEqual(["criteria-seal", "acceptance-evaluated"]);
    expect(names.slice(0, -4)).toStrictEqual([...REQUIRED_SECURITY_FIXTURE_IDS]);
  });

  it("FIRES every one of them through the composed registry, each emitting its own EvidenceRecord bound to the candidate", async () => {
    const registry = composeGateRegistry({
      attempts: NO_ATTEMPTS,
      projectId: "fixture-project",
      requirements: requirements([]),
      workUnits: units([]),
    });

    const results = await registry.fireByTag("security", {
      stage: "final_verifying",
      changeSetId: CHANGE_SET_ID,
      objectId: OBJECT_ID,
      journal,
    });

    // Registration alone would be satisfied by a handler that throws. The
    // failures are listed BY NAME rather than counted, so a red run says which
    // fixture broke instead of "expected true to be false".
    expect(
      results
        .filter((result) => !result.verdict.passed)
        .map((result) => `${result.name}: ${result.verdict.detail}`),
    ).toStrictEqual([]);
    expect(results.map((result) => result.name)).toStrictEqual([...REQUIRED_SECURITY_FIXTURE_IDS]);
    // `EvidenceRecord` has no gate-name member, so the fixture id reaches the
    // journal as `command` — `pass()`/`fail()` in
    // `packages/gates/src/security-fixture-manifest.ts` set it to the id. That
    // is the field the composed-path e2e filters on, so pin it here too.
    expect(results.map((result) => result.evidence.command)).toStrictEqual([
      ...REQUIRED_SECURITY_FIXTURE_IDS,
    ]);
    expect(results.map((result) => result.evidence.objectId)).toStrictEqual(
      REQUIRED_SECURITY_FIXTURE_IDS.map(() => OBJECT_ID),
    );
    expect(results.map((result) => result.evidence.gateTag)).toStrictEqual(
      REQUIRED_SECURITY_FIXTURE_IDS.map(() => "security"),
    );
  });
});

describe("the composed requirements reader", () => {
  it("resolves the WHOLE change set's requirement union, not one unit's — the blind spot the gate exists to cover", async () => {
    const first = buildRequirement({ id: REQ_1 });
    const second = buildRequirement({ id: REQ_2 });
    await journalCriteriaSeal(journal, {
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { [REQ_1]: first.criteriaHash, [REQ_2]: second.criteriaHash },
    });

    const registry = composeGateRegistry({
      attempts: NO_ATTEMPTS,
      projectId: "fixture-project",
      requirements: requirements([first, second]),
      // Two units, one requirement each — a per-unit reader would verify one.
      workUnits: units([
        unit(UNIT_A, CHANGE_SET_ID, [REQ_1]),
        unit(UNIT_B, CHANGE_SET_ID, [REQ_2]),
      ]),
    });

    const results = await registry.fireByTag("acceptance", {
      stage: "final_verifying",
      changeSetId: CHANGE_SET_ID,
      objectId: OBJECT_ID,
      journal,
    });

    // BOTH acceptance gates share this one reader (R5), so the union claim is
    // asserted through each of them — a reader scoped to one unit would report
    // 1 in either place and still pass.
    const seal = results.find((result) => result.name === "criteria-seal");
    expect(seal?.verdict.passed).toBe(true);
    expect(JSON.parse(seal!.verdict.detail) as { verified: number }).toStrictEqual({
      verified: 2,
    });

    const evaluated = results.find((result) => result.name === "acceptance-evaluated");
    // It REFUSES here, and that is the correct answer: this fixture seals two
    // requirements and journals no evaluation for either. What it pins is that
    // the refusal names BOTH — the union, not one unit's half.
    expect(evaluated?.verdict.passed).toBe(false);
    const detail = JSON.parse(evaluated!.verdict.detail) as {
      readonly unevaluated: readonly { readonly requirementId: string }[];
    };
    expect(detail.unevaluated.map((entry) => entry.requirementId).sort()).toStrictEqual(
      [REQ_1, REQ_2].sort(),
    );
  });

  it("reads the records WHEN IT FIRES, so a post-registration tamper is caught", async () => {
    const approved = buildRequirement({ id: REQ_1, acceptanceCriteria: ["as approved"] });
    const tampered = buildRequirement({
      id: REQ_1,
      acceptanceCriteria: ["as approved", "and more"],
    });
    expect(tampered.criteriaHash).not.toBe(approved.criteriaHash);
    await journalCriteriaSeal(journal, {
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { [REQ_1]: approved.criteriaHash },
    });

    const registryStore = requirements([approved]);
    const registry = composeGateRegistry({
      attempts: NO_ATTEMPTS,
      projectId: "fixture-project",
      requirements: registryStore,
      workUnits: units([unit(UNIT_A, CHANGE_SET_ID, [REQ_1])]),
    });
    // The edit lands AFTER registration. A reader that snapshotted at
    // registration time would still see the approved record and pass.
    registryStore.put(tampered);

    const results = await registry.fireByTag("acceptance", {
      stage: "final_verifying",
      changeSetId: CHANGE_SET_ID,
      objectId: OBJECT_ID,
      journal,
    });
    expect(results[0]?.verdict.passed).toBe(false);
    expect(results[0]?.verdict.detail).toContain("approval_seal_mismatch");
    expect(results[0]?.verdict.detail).toContain(REQ_1);
    // Ids and hashes only — never the attacker-authored criteria text.
    expect(results[0]?.verdict.detail).not.toContain("and more");
  });

  it("REFUSES rather than shrinking the bar when a declared id resolves to no record", async () => {
    await journalCriteriaSeal(journal, {
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { [REQ_1]: "sha256:whatever" },
    });
    const registry = composeGateRegistry({
      attempts: NO_ATTEMPTS,
      projectId: "fixture-project",
      // `requirements.json` holds nothing; the unit declares an id anyway.
      requirements: requirements([]),
      workUnits: units([unit(UNIT_A, CHANGE_SET_ID, [REQ_1])]),
    });

    await expect(
      registry.fireByTag("acceptance", {
        stage: "final_verifying",
        changeSetId: CHANGE_SET_ID,
        objectId: OBJECT_ID,
        journal,
      }),
    ).rejects.toThrow(UnresolvedRequirementError);
  });
});

describe("changeSetRequirementIds", () => {
  it("unions every unit's declared ids, deduped, in first-seen order", () => {
    const registry = units([
      unit(UNIT_A, CHANGE_SET_ID, [REQ_2, REQ_1]),
      unit(UNIT_B, CHANGE_SET_ID, [REQ_1]),
    ]);
    expect(changeSetRequirementIds(registry, CHANGE_SET_ID)).toStrictEqual([REQ_2, REQ_1]);
  });

  it("never leaks another change set's requirements", () => {
    const registry = units([
      unit(UNIT_A, CHANGE_SET_ID, [REQ_1]),
      unit(UNIT_B, OTHER_CHANGE_SET_ID, [REQ_2]),
    ]);
    expect(changeSetRequirementIds(registry, CHANGE_SET_ID)).toStrictEqual([REQ_1]);
  });

  it("is empty for a change set whose units declare nothing — the chore unit, not a missing record", () => {
    expect(
      changeSetRequirementIds(units([unit(UNIT_A, CHANGE_SET_ID, [])]), CHANGE_SET_ID),
    ).toEqual([]);
  });
});

/**
 * ORDER THE BUILD IN THE CANDIDATE'S WORKTREE TOO (2026-09-05).
 *
 * The same defect `captureTddBaseline` carries at base: an attempt worktree has
 * its `node_modules` provisioned but never its `dist/`, so the granted
 * acceptance command measures a missing build output. On the candidate side the
 * cost is a REFUSAL WITH THE WRONG REASON — the suite emits no report, the
 * coverage gate says "no coverage report was produced", and an operator reads
 * that as a project that forgot its reporter rather than as a tree nobody built.
 *
 * `worktree-dependencies.ts` predicted this and assigned it here: "the gap
 * belongs to the scheduler's ordering rather than to this module". That module
 * now marks the gap DISCHARGED and names this as one of the three ordering
 * sites, so the sentence this comment used to quote ("Nothing currently orders
 * that build first") is gone from it — quoted here as it reads today, not as
 * it read when the gap was open.
 */
describe("the candidate suite runs the granted build first", () => {
  let candidateTree: string;

  function attemptsFor(treeDir: string): typeof NO_ATTEMPTS {
    return {
      ...NO_ATTEMPTS,
      worktreePathFor: (): string | undefined => treeDir,
      grantedCommandsFor: (): readonly string[] | undefined => ["npm run test", "npm run build"],
    };
  }

  async function fireCoverage(
    treeDir: string,
    grantedCommands: readonly string[] = ["npm run test", "npm run build"],
  ): Promise<{ passed: boolean; detail: string }> {
    const registry = composeGateRegistry({
      attempts: {
        ...attemptsFor(treeDir),
        grantedCommandsFor: (): readonly string[] | undefined => grantedCommands,
      },
      projectId: "fixture-project",
      requirements: requirements([]),
      workUnits: units([unit(UNIT_A, CHANGE_SET_ID, [])]),
    });
    const results = await registry.firePerWorkUnit({
      stage: "verifying",
      changeSetId: CHANGE_SET_ID,
      workUnitId: UNIT_A,
      objectId: OBJECT_ID,
      journal,
    });
    const coverage = results.find((result) => result.name === "changed-line-coverage");
    expect(coverage).toBeDefined();
    return { passed: coverage!.verdict.passed, detail: coverage!.verdict.detail };
  }

  afterEach(async () => {
    if (candidateTree !== undefined) await rm(candidateTree, { recursive: true, force: true });
  });

  /**
   * A build that failed must never reach a PASSING coverage verdict. Without
   * the build ordered, the suite ran in an unbuilt tree, emitted no report, and
   * the gate refused for a reason that had nothing to do with the cause; with
   * it ordered the refusal stands on the real one. Either way it refuses —
   * which is the safety property, and it is asserted here rather than assumed.
   */
  it("never lets a failed build reach a passing coverage verdict", async () => {
    candidateTree = await scriptedTree({ build: "exit 3", test: "exit 0" });
    expect((await fireCoverage(candidateTree)).passed).toBe(false);
  });

  /**
   * ⚠️ ASSERTED THROUGH THE WIRING, not as a pure function. A review round
   * showed the first form of this test called `describeFailedIntegrityCommand`
   * directly while its comment claimed to pin what an operator reads — so
   * replacing the call site with any other string would have kept it green.
   *
   * The TDD gate is the verdict that can carry the reason: it surfaces
   * `CandidateTestRun.command` verbatim. Reaching it needs the red half
   * established first, so the BASE tree here builds and fails its tests
   * (a genuine red baseline) while the CANDIDATE tree's build is broken.
   */
  it("names the failed build in the verdict an operator actually reads", async () => {
    candidateTree = await scriptedTree({ build: "exit 3", test: "exit 0" });
    const baseTree = await scriptedTree({ build: "exit 0", test: "exit 1" });
    const registry = composeGateRegistry({
      attempts: {
        ...attemptsFor(candidateTree),
        diffAgainstBase: (): Promise<string | undefined> =>
          Promise.resolve("--- a/src/x.test.ts\n+++ b/src/x.test.ts\n+it('x', () => {});\n"),
        ...baseTreeSurface(baseTree),
      },
      projectId: "fixture-project",
      requirements: requirements([buildRequirement({ id: REQ_1 })]),
      workUnits: units([unit(UNIT_A, CHANGE_SET_ID, [REQ_1])]),
    });
    const results = await registry.firePerWorkUnit({
      stage: "verifying",
      changeSetId: CHANGE_SET_ID,
      workUnitId: UNIT_A,
      objectId: OBJECT_ID,
      journal,
    });
    const tdd = results.find((result) => result.name === "tdd-evidence");
    expect(tdd?.verdict.passed).toBe(false);
    expect(tdd?.verdict.command).toContain("npm run build");
    expect(tdd?.verdict.command).toMatch(/build failed/i);
    await rm(baseTree, { recursive: true, force: true });
  });

  /**
   * ⚠️ THE BRANCH THE WHOLE REPAIR EXISTS FOR, executed rather than described.
   *
   * The first cut of this ordering guarded on `build.ran && exitStatus !== 0`,
   * so a build killed on the timeout fell through into an unbuilt tree. The
   * corrected guard was then measured as unreachable by any test — flipping its
   * `suiteRan: false` to `true` left the whole `packages/cli` suite green — and
   * a branch nothing reaches is a branch nothing pins, which is how the guard it
   * replaced shipped wrong in the first place. `commandTimeoutMs` exists so this
   * can run in milliseconds instead of fifteen minutes.
   *
   * Both halves are asserted: the operator-facing reason, and the fact that a
   * pre-planted report is still not scored.
   */
  it("refuses a build that never completed, and still scores no stale report", async () => {
    candidateTree = await scriptedTree({
      build: `node -e "setTimeout(()=>{},60000)"`,
      test: "exit 0",
    });
    await mkdir(join(candidateTree, "coverage"), { recursive: true });
    await writeFile(
      join(candidateTree, "coverage", "lcov.info"),
      ["TN:", "SF:src/a.ts", "DA:1,1", "LF:1", "LH:1", "end_of_record", ""].join("\n"),
      "utf8",
    );
    const baseTree = await scriptedTree({ build: "exit 0", test: "exit 1" });
    const registry = composeGateRegistry({
      attempts: {
        ...attemptsFor(candidateTree),
        diffAgainstBase: (): Promise<string | undefined> =>
          Promise.resolve("--- a/src/x.test.ts\n+++ b/src/x.test.ts\n+it('x', () => {});\n"),
        ...baseTreeSurface(baseTree),
      },
      projectId: "fixture-project",
      requirements: requirements([buildRequirement({ id: REQ_1 })]),
      workUnits: units([unit(UNIT_A, CHANGE_SET_ID, [REQ_1])]),
      commandTimeoutMs: FIXTURE_COMMAND_CEILING_MS,
    });
    const results = await registry.firePerWorkUnit({
      stage: "verifying",
      changeSetId: CHANGE_SET_ID,
      workUnitId: UNIT_A,
      objectId: OBJECT_ID,
      journal,
    });

    const tdd = results.find((result) => result.name === "tdd-evidence");
    expect(tdd?.verdict.passed).toBe(false);
    expect(tdd?.verdict.command).toMatch(/did not complete/i);
    expect(tdd?.verdict.command).toContain("npm run build");

    const coverage = results.find((result) => result.name === "changed-line-coverage");
    expect(coverage?.verdict.passed).toBe(false);
    expect(coverage?.verdict.detail).not.toMatch(/coverage OK/);
    await rm(baseTree, { recursive: true, force: true });
  });

  /** The string itself, as a cheap sibling of the wiring assertion above. */
  it("says the build and its exit status, and never blames the reporter", () => {
    const message = describeFailedIntegrityCommand("npm run build", 3);
    expect(message).toContain("npm run build");
    expect(message).toContain("3");
    expect(message).not.toMatch(/coverage report/);
  });

  /**
   * ⚠️ THE ORDER IS PROVEN, NOT THE EXECUTION. An earlier version of this test
   * had the BUILD write the report, which a review round showed pins nothing:
   * `loadCandidateCoverage` reads the report only after the whole run resolves,
   * so a build moved BELOW the acceptance command would still have left the
   * file there in time and the test would still have passed.
   *
   * Now the build writes only a marker and the SUITE writes the report, and
   * only when the marker is already there. "coverage OK" is then reachable
   * exactly when the build genuinely preceded the suite.
   */
  it("runs the build BEFORE the suite, proven by a marker the suite requires", async () => {
    candidateTree = await scriptedTree({
      build: `node -e "require('fs').writeFileSync('built.txt','1')"`,
      test:
        `node -e "if(!require('fs').existsSync('built.txt'))process.exit(1);` +
        `require('fs').mkdirSync('coverage',{recursive:true});` +
        `require('fs').writeFileSync('coverage/lcov.info',` +
        `['TN:','SF:src/a.ts','DA:1,1','LF:1','LH:1','end_of_record',''].join(String.fromCharCode(10)))"`,
    });
    const outcome = await fireCoverage(candidateTree);
    expect(outcome.detail).not.toMatch(/no coverage report was produced/);
    expect(outcome.detail).toMatch(/coverage OK/);
  });

  /**
   * ⚠️ A STALE REPORT FROM THE PRE-DISPATCH BASE RUN MUST NOT BE SCORED AS THE
   * CANDIDATE'S (2026-09-05, raised by adversarial review of this very fix).
   *
   * `captureTddBaseline` runs pre-dispatch in the ATTEMPT'S OWN worktree — "the
   * worktree comes from `retainedWorkers`, not a second `git worktree add`" —
   * so once the build is ordered, that base run leaves a real
   * `coverage/lcov.info` behind describing BASE coverage. Ordering the build
   * therefore created a report where none used to exist, and the refusal
   * added beside it returns BEFORE the suite runs, so nothing overwrites it.
   * `loadCandidateCoverage` would then read the base's report, score the diff
   * against it, and publish `passed: true` for a candidate whose build is
   * broken — strictly worse than the misleading refusal being fixed.
   *
   * The rule this restores is the gate's own: an unmeasured candidate is
   * refused. A suite that never ran produced no measurement, whatever file
   * happens to be on disk.
   */
  it("never scores a report the candidate's own suite did not produce", async () => {
    candidateTree = await scriptedTree({ build: "exit 3", test: "exit 0" });
    await mkdir(join(candidateTree, "coverage"), { recursive: true });
    await writeFile(
      join(candidateTree, "coverage", "lcov.info"),
      ["TN:", "SF:src/a.ts", "DA:1,1", "LF:1", "LH:1", "end_of_record", ""].join("\n"),
      "utf8",
    );
    const outcome = await fireCoverage(candidateTree);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).not.toMatch(/coverage OK/);
  });

  /**
   * ⚠️ ASSERTED ON THE FILESYSTEM, not on the verdict. A review round showed
   * the previous form of this test watched a channel that cannot tell the two
   * worlds apart: the coverage verdict says "no report" whether the build was
   * skipped or merely useless, so both the correct behaviour and its opposite
   * were green. A sentinel the build itself writes is the observable that
   * actually discriminates.
   */
  it("does not run a build the envelope does not grant", async () => {
    candidateTree = await scriptedTree({
      build: `node -e "require('fs').writeFileSync('sentinel.txt','ran')"`,
      test: "exit 0",
    });
    await fireCoverage(candidateTree, ["npm run test"]);
    expect(existsSync(join(candidateTree, "sentinel.txt"))).toBe(false);
  });

  /** The same sentinel, the same fixture, one grant added — so the pair isolates the grant. */
  it("runs exactly the build the envelope does grant", async () => {
    candidateTree = await scriptedTree({
      build: `node -e "require('fs').writeFileSync('sentinel.txt','ran')"`,
      test: "exit 0",
    });
    await fireCoverage(candidateTree, ["npm run test", "npm run build"]);
    expect(existsSync(join(candidateTree, "sentinel.txt"))).toBe(true);
  });
});

/**
 * The BASE tree's build — the half of the ordering repair that had no test at
 * all until 2026-09-05, measured rather than asserted: v8 reported ZERO hits on
 * every statement of the `prepareBaseTree` closure across 727 files / 7940
 * tests, and deleting the closure outright left the suite green.
 *
 * ⚠️ WHY AN UNEXECUTED GUARD HERE IS BLOCKING RATHER THAN UNTIDY. A base
 * worktree is materialised from tracked files only, and a workspace package's
 * `main` points into a gitignored `dist/`. With no build, the scoped acceptance
 * command exits non-zero on `ERR_MODULE_NOT_FOUND` before one test executes,
 * and `captureRedBaselineForChangedTests` cannot tell that from a genuinely
 * failing test: it mints `captured` plus one red-baseline `EvidenceRecord` per
 * requirement. The failure direction is therefore PASS — the strongest evidence
 * this system has, earned by an absent build output.
 *
 * So each case below asserts the journal as well as the verdict. A refusal that
 * still minted a baseline would be a refusal in name only.
 */
describe("the base tree is built while it is still the base", () => {
  let candidateTree: string | undefined;
  let baseTree: string | undefined;

  afterEach(async () => {
    for (const tree of [candidateTree, baseTree]) {
      if (tree !== undefined) await rm(tree, { recursive: true, force: true });
    }
    candidateTree = undefined;
    baseTree = undefined;
  });

  async function fireTdd(
    options: {
      readonly commandTimeoutMs?: number;
      /** `false` models a candidate whose attempt worktree the dispatcher no longer retains. */
      readonly candidateWorktreeRetained?: boolean;
    } = {},
  ): Promise<{
    readonly passed: boolean;
    readonly inconclusive: boolean;
    readonly detail: string;
    readonly command: string;
    readonly hasGateVerdict: boolean;
  }> {
    const registry = composeGateRegistry({
      attempts: {
        ...NO_ATTEMPTS,
        worktreePathFor: (): string | undefined =>
          options.candidateWorktreeRetained === false ? undefined : candidateTree,
        grantedCommandsFor: (): readonly string[] | undefined => ["npm run test", "npm run build"],
        diffAgainstBase: (): Promise<string | undefined> =>
          Promise.resolve("--- a/src/x.test.ts\n+++ b/src/x.test.ts\n+it('x', () => {});\n"),
        ...baseTreeSurface(baseTree!),
      },
      projectId: "fixture-project",
      requirements: requirements([buildRequirement({ id: REQ_1 })]),
      workUnits: units([unit(UNIT_A, CHANGE_SET_ID, [REQ_1])]),
      ...(options.commandTimeoutMs !== undefined
        ? { commandTimeoutMs: options.commandTimeoutMs }
        : {}),
    });
    const results = await registry.firePerWorkUnit({
      stage: "verifying",
      changeSetId: CHANGE_SET_ID,
      workUnitId: UNIT_A,
      objectId: OBJECT_ID,
      journal,
    });
    const tdd = results.find((result) => result.name === "tdd-evidence");
    expect(tdd).toBeDefined();
    return {
      passed: tdd!.verdict.passed,
      inconclusive: tdd!.verdict.inconclusive === true,
      detail: tdd!.verdict.detail,
      command: tdd!.verdict.command,
      hasGateVerdict: tdd!.evidence.gateVerdict !== undefined,
    };
  }

  /**
   * ⚠️ A MEASURED RED HALF AND NO CANDIDATE TO MEASURE AGAINST — the one
   * ordering in which this refusal is reachable, since the gate short-circuits
   * before the candidate run whenever the red half is unestablished. It FAILS
   * rather than going inconclusive, and it must: the red baseline says these
   * tests were failing, and "we could not check whether they now pass" is not a
   * green half.
   */
  it("fails, naming the unit, when the candidate's own worktree is no longer retained", async () => {
    candidateTree = await scriptedTree({ build: "exit 0", test: "exit 0" });
    baseTree = await scriptedTree({ build: "exit 0", test: "exit 1" });

    const tdd = await fireTdd({ candidateWorktreeRetained: false });

    expect(tdd.passed).toBe(false);
    expect(tdd.command).toContain("no retained worktree");
    expect(tdd.command).toContain(UNIT_A);
  });

  /**
   * Deleting the closure makes the base suite run in an unbuilt tree, exit 1,
   * and mint `captured` — so both assertions below flip. That is the mutation
   * this case exists to redden.
   */
  it("refuses when the granted build FAILS in the base tree, and mints no baseline", async () => {
    candidateTree = await scriptedTree({ build: "exit 0", test: "exit 0" });
    baseTree = await scriptedTree({ build: "exit 3", test: "exit 1" });

    const tdd = await fireTdd();

    expect(tdd.detail).toMatch(/FAILED in the base tree with exit 3/);
    expect(tdd.inconclusive).toBe(true);
    // Inconclusive is normalised to non-blocking, so the record is the claim:
    // an unestablished red half must prove nothing at all.
    expect(tdd.hasGateVerdict).toBe(false);
    expect(await hasRedBaseline(journal, REQ_1)).toBe(false);
  });

  /**
   * ⚠️ THE BRANCH THAT WAS FIFTEEN MINUTES OUT OF REACH. `commandTimeoutMs`
   * bounded only the CANDIDATE build when it was introduced, so this
   * structurally identical guard on the base side could not be reached by any
   * test in under `TDD_BASELINE_TIMEOUT_MS` — and a branch nothing reaches is a
   * branch nothing pins, which is how the guard it replaced shipped wrong.
   */
  it("refuses a base build that never completed, and says so in the operator's words", async () => {
    candidateTree = await scriptedTree({ build: "exit 0", test: "exit 0" });
    baseTree = await scriptedTree({
      build: `node -e "setTimeout(()=>{},60000)"`,
      test: "exit 1",
    });

    const tdd = await fireTdd({ commandTimeoutMs: FIXTURE_COMMAND_CEILING_MS });

    expect(tdd.detail).toMatch(/did not complete in the base tree/);
    expect(tdd.detail).toContain("npm run build");
    expect(await hasRedBaseline(journal, REQ_1)).toBe(false);
  });

  /**
   * ⚠️ THE THIRD OF THE FOUR COMMANDS THE CEILING NAMES. A base suite killed on
   * the timeout also exits non-zero, and folding that into the red path would
   * let a hung runner mint a baseline. `captureRedBaselineForChangedTests`
   * separates them — but only if it is given the ceiling, which it was not
   * until this case existed to require it.
   */
  it("refuses a base suite that never completed, rather than reading it as red", async () => {
    candidateTree = await scriptedTree({ build: "exit 0", test: "exit 0" });
    baseTree = await scriptedTree({
      build: "exit 0",
      test: `node -e "setTimeout(()=>{},60000)"`,
    });

    const tdd = await fireTdd({ commandTimeoutMs: FIXTURE_COMMAND_CEILING_MS });

    expect(tdd.detail).toMatch(/the base-code test run did not complete/);
    expect(tdd.hasGateVerdict).toBe(false);
    expect(await hasRedBaseline(journal, REQ_1)).toBe(false);
  });

  /**
   * ⚠️ THE FOURTH, and the one whose only honest observable is the CLOCK. A
   * candidate suite killed on the timeout produces the same "STILL failing"
   * detail a genuinely failing one does, so the message cannot discriminate.
   * What can is that this finishes at all: unbounded, the granted command runs
   * on `TDD_BASELINE_TIMEOUT_MS` and this case takes fifteen minutes.
   */
  it("bounds the candidate SUITE too, not only the candidate build", async () => {
    candidateTree = await scriptedTree({
      build: "exit 0",
      test: `node -e "setTimeout(()=>{},60000)"`,
    });
    baseTree = await scriptedTree({ build: "exit 0", test: "exit 1" });

    const startedAt = Date.now();
    const tdd = await fireTdd({ commandTimeoutMs: FIXTURE_COMMAND_CEILING_MS });

    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expect(tdd.passed).toBe(false);
    expect(await hasRedBaseline(journal, REQ_1)).toBe(true);
  });

  /**
   * ⚠️ THE ORDER, PROVEN BY A MARKER — the base-side mirror of the candidate
   * test above, and the one case that can tell "the build ran" from "the build
   * ran FIRST". The base suite is red exactly when the build already wrote its
   * marker, so `captured` is reachable only through the correct ordering.
   *
   * `passed` is deliberately NOT the discriminator: an unestablished red half
   * is normalised to non-blocking, so it reads `true` in both worlds. The
   * detail and the journal are what differ.
   */
  it("runs the base build BEFORE the base suite, proven by a marker the suite requires", async () => {
    candidateTree = await scriptedTree({ build: "exit 0", test: "exit 0" });
    baseTree = await scriptedTree({
      build: `node -e "require('fs').writeFileSync('built.txt','1')"`,
      test: `node -e "process.exit(require('fs').existsSync('built.txt')?1:0)"`,
    });

    const tdd = await fireTdd();

    expect(tdd.detail).toMatch(/fail against base and pass against the candidate/);
    expect(tdd.passed).toBe(true);
    expect(tdd.hasGateVerdict).toBe(true);
    expect(await hasRedBaseline(journal, REQ_1)).toBe(true);
  });
});
