/**
 * Unit-level coverage of the post-completion pipeline's own decisions — the
 * ones a composed end-to-end run cannot reach or cannot isolate.
 *
 * SCOPE, STATED SO NOTHING HERE IS CITED FOR MORE THAN IT CARRIES: these tests
 * hand the pipeline a registry directly, so they prove nothing about production
 * COMPOSITION. That is `./composed-post-completion.e2e.test.ts`'s job (real
 * `composeSupervisor` + real git) and `./compose-gate-registry.test.ts`'s. What
 * lives here is the fail-closed mapping, the ordering rule, the conflict
 * terminal, and the cancel race — each of which needs a condition production
 * composition cannot produce on demand.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  WorkUnitSchema,
  type ChangeSet,
  type Requirement,
  type WorkUnit,
  type WorkUnitAttemptStatus,
} from "@crabgic/contracts";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { createGateRegistry, type GateRegistry } from "@crabgic/gates";
import {
  createRequirementsRegistry,
  createRunsRegistry,
  createWorkUnitsRegistry,
  transitionRun,
  type Registry,
  type RunsRegistry,
} from "@crabgic/supervisor";
import { buildChangeSet, buildRequirement, buildWorkUnit } from "@crabgic/testkit";
import { composeGateRegistry } from "./compose-gate-registry.js";
import {
  commitFieldsFor,
  deriveBranchType,
  type PostCompletionGitEffects,
} from "./post-completion-git-effects.js";
import {
  integrationOrderFor,
  runPostCompletionPipeline,
  type PostCompletionOutcome,
} from "./post-completion-pipeline.js";
import { createFakePostCompletionGitEffects } from "./test-support/fake-post-completion-git-effects.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const UNIT_A = "33333333-3333-4333-8333-333333333333";
const UNIT_B = "44444444-4444-4444-8444-444444444444";
const REQ_ID = "55555555-5555-4555-8555-555555555555";
const BASE = "a".repeat(40);

let dir: string;
let journal: JournalStore;
let runs: RunsRegistry;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eo-post-pipeline-"));
  journal = createJournalStore({ journalDir: join(dir, "journal") });
  runs = createRunsRegistry();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

function unit(id: string, overrides: Partial<WorkUnit> = {}): WorkUnit {
  return buildWorkUnit({
    id,
    changeSetId: CHANGE_SET_ID,
    dependsOn: [],
    attemptStatus: "pending",
    requirementIds: [],
    ...overrides,
  });
}

function changeSet(integrationOrder: readonly string[] = []): ChangeSet {
  return buildChangeSet({
    id: CHANGE_SET_ID,
    state: "ready",
    integrationOrder: [...integrationOrder],
  });
}

/** Walks the run to `running` through the real transition surface, exactly as `createRun` does. */
async function seedRunningRun(): Promise<void> {
  for (const to of ["awaiting_approval", "ready", "running"] as const) {
    await transitionRun({ journal, runs, runId: RUN_ID, changeSetId: CHANGE_SET_ID, to });
  }
}

function requirementsRegistry(records: readonly Requirement[]): Registry<Requirement> {
  const registry = createRequirementsRegistry();
  for (const record of records) registry.put(record);
  return registry;
}

function workUnitRegistry(units: readonly WorkUnit[]): Registry<WorkUnit> {
  const registry = createWorkUnitsRegistry();
  for (const record of units) registry.put(record);
  return registry;
}

async function run(options: {
  readonly units: readonly WorkUnit[];
  readonly changeSet?: ChangeSet;
  readonly registry: GateRegistry;
  readonly git?: PostCompletionGitEffects;
  readonly requirements?: readonly Requirement[];
  readonly requirementsOverride?: Registry<Requirement>;
  readonly runsOverride?: RunsRegistry;
  readonly statuses?: ReadonlyMap<string, WorkUnitAttemptStatus>;
  readonly worktrees?: ReadonlyMap<string, string>;
}): Promise<PostCompletionOutcome> {
  const units = options.units;
  return runPostCompletionPipeline(
    {
      runId: RUN_ID,
      changeSet: options.changeSet ?? changeSet(units.map((u) => u.id)),
      workUnits: units,
      baseObjectId: BASE,
      statusById:
        options.statuses ?? new Map(units.map((u) => [u.id, "succeeded" as WorkUnitAttemptStatus])),
      worktreePathByUnitId:
        options.worktrees ?? new Map(units.map((u) => [u.id, join(dir, "wt", u.id)])),
    },
    {
      journal,
      runs: options.runsOverride ?? runs,
      requirements:
        options.requirementsOverride ?? requirementsRegistry(options.requirements ?? []),
      workUnitRegistry: workUnitRegistry(units),
      registry: options.registry,
      git: options.git ?? createFakePostCompletionGitEffects(),
    },
  );
}

/** A registry with one always-passing gate — enough to satisfy `requireAtLeastOne` without asserting anything about the seal gate. */
function passingRegistry(): GateRegistry {
  const registry = createGateRegistry();
  registry.register("acceptance", "always-passes", () =>
    Promise.resolve({
      passed: true,
      command: "test: always passes",
      exitStatus: 0,
      toolchainFingerprint: "test",
      artifactDigests: [],
      detail: "{}",
    }),
  );
  return registry;
}

describe("fail-closed: an empty gate registry never publishes", () => {
  it("settles the run failed rather than publishing against zero verified gates", async () => {
    await seedRunningRun();
    // `fireAll([])` would be vacuously green (`[].every(...) === true`), which is
    // why `fireFinalCandidateVerification` passes `requireAtLeastOne`. What is
    // asserted here is that the PIPELINE maps that throw onto the run's state —
    // the throw existing inside `packages/gates` proves nothing about the daemon.
    const outcome = await run({ units: [unit(UNIT_A)], registry: createGateRegistry() });

    expect(outcome.status).toBe("failed");
    expect(runs.get(RUN_ID)?.runState).toBe("failed");
    expect(runs.get(RUN_ID)?.runState).not.toBe("published_local");
    if (outcome.status !== "failed") return;
    expect(outcome.reason).toContain("zero registered handlers");
  });

  it("CONTROL — the identical run publishes once one gate is registered", async () => {
    await seedRunningRun();
    const outcome = await run({ units: [unit(UNIT_A)], registry: passingRegistry() });

    expect(outcome.status).toBe("published");
    expect(runs.get(RUN_ID)?.runState).toBe("published_local");
  });

  it("settles the run failed when a declared requirement id resolves to no record", async () => {
    await seedRunningRun();
    // The composed registry's requirements reader resolves STRICTLY, so this is
    // the run-level, inputs-incoherent refusal — not a per-unit verdict.
    const units = [unit(UNIT_A, { requirementIds: [REQ_ID] })];
    const outcome = await runPostCompletionPipeline(
      {
        runId: RUN_ID,
        changeSet: changeSet([UNIT_A]),
        workUnits: units,
        baseObjectId: BASE,
        statusById: new Map([[UNIT_A, "succeeded"]]),
        worktreePathByUnitId: new Map([[UNIT_A, join(dir, "wt")]]),
      },
      {
        journal,
        runs,
        // Empty: the declared id resolves to nothing.
        requirements: requirementsRegistry([]),
        workUnitRegistry: workUnitRegistry(units),
        registry: composeGateRegistry({
          requirements: requirementsRegistry([]),
          workUnits: workUnitRegistry(units),
        }),
        git: createFakePostCompletionGitEffects(),
      },
    );

    expect(outcome.status).toBe("failed");
    expect(runs.get(RUN_ID)?.runState).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.reason).toContain(REQ_ID);
  });
});

describe("a failing gate refuses publication and names the gate", () => {
  it("settles failed, publishes nothing, and carries the handler's own detail", async () => {
    await seedRunningRun();
    const registry = createGateRegistry();
    registry.register("acceptance", "always-fails", () =>
      Promise.resolve({
        passed: false,
        command: "test: always fails",
        exitStatus: 1,
        toolchainFingerprint: "test",
        artifactDigests: [],
        detail: JSON.stringify({ failures: [{ requirementId: REQ_ID, reason: "test-reason" }] }),
      }),
    );
    const calls: string[] = [];
    const outcome = await run({
      units: [unit(UNIT_A)],
      registry,
      git: createFakePostCompletionGitEffects({ calls }),
    });

    expect(outcome.status).toBe("failed");
    expect(runs.get(RUN_ID)?.runState).toBe("failed");
    if (outcome.status !== "failed") return;
    // The gate is named, under its tag, with its own detail — an unrelated
    // failure could not produce this string.
    expect(outcome.reason).toContain("always-fails");
    expect(outcome.reason).toContain("acceptance");
    expect(outcome.reason).toContain(REQ_ID);
    // Nothing published: the publish step was never reached.
    expect(calls.filter((call) => call.startsWith("publish:"))).toEqual([]);
  });
});

describe("integration conflicts settle blocked, with the resolution units journaled", () => {
  it("journals the typed resolution work units and names the conflicted path", async () => {
    await seedRunningRun();
    const resolution = WorkUnitSchema.parse({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: "77777777-7777-4777-8777-777777777777",
      changeSetId: CHANGE_SET_ID,
      title: "Resolve merge conflict in src/shared.ts",
      requirementIds: [],
      dependsOn: [],
      role: "merge-conflict-resolution",
      ownedPaths: ["src/shared.ts"],
      attemptStatus: "pending",
    });
    const conflicting: PostCompletionGitEffects = {
      ...createFakePostCompletionGitEffects(),
      integrateCandidate: () =>
        Promise.resolve({ status: "conflict", resolutionUnits: [resolution] }),
    };

    const outcome = await run({
      units: [unit(UNIT_A)],
      registry: passingRegistry(),
      git: conflicting,
    });

    expect(outcome.status).toBe("blocked");
    expect(runs.get(RUN_ID)?.runState).toBe("blocked");
    if (outcome.status !== "blocked") return;
    expect(outcome.reason).toContain("src/shared.ts");

    // NOT just "blocked": the typed resolution units are on the record, so a
    // crashed pipeline that merely blocked cannot satisfy this.
    const decisions: { decision: string; rationale: string }[] = [];
    for await (const entry of journal.queryEntries({ type: "adjudication_decision" })) {
      if (entry.type !== "adjudication_decision") continue;
      decisions.push({ decision: entry.payload.decision, rationale: entry.payload.rationale });
    }
    const conflicts = decisions.filter((d) => d.decision === "integration_conflict");
    expect(conflicts).toHaveLength(1);
    const parsed = JSON.parse(conflicts[0]!.rationale) as {
      readonly resolutionWorkUnits: readonly {
        readonly id: string;
        readonly ownedPaths: readonly string[];
      }[];
    };
    expect(parsed.resolutionWorkUnits).toHaveLength(1);
    expect(parsed.resolutionWorkUnits[0]?.id).toBe(resolution.id);
    expect(parsed.resolutionWorkUnits[0]?.ownedPaths).toEqual(["src/shared.ts"]);
  });
});

describe("each git-effect refusal maps onto its own lifecycle terminal", () => {
  it("a lint-blocked collection settles blocked and never reaches integration", async () => {
    await seedRunningRun();
    const calls: string[] = [];
    const blocking: PostCompletionGitEffects = {
      ...createFakePostCompletionGitEffects({ calls }),
      collectCandidate: () =>
        Promise.resolve({ status: "blocked", reason: "policy_blocked: subject" }),
    };

    const outcome = await run({
      units: [unit(UNIT_A)],
      registry: passingRegistry(),
      git: blocking,
    });

    expect(outcome.status).toBe("blocked");
    expect(runs.get(RUN_ID)?.runState).toBe("blocked");
    if (outcome.status !== "blocked") return;
    expect(outcome.reason).toContain(UNIT_A);
    expect(outcome.reason).toContain("policy_blocked");
    // The walk stopped in `verifying`: nothing was integrated or published.
    expect(calls.filter((call) => call.startsWith("begin:"))).toEqual([]);
    expect(calls.filter((call) => call.startsWith("publish:"))).toEqual([]);
  });

  it("an integration ref left by an interrupted pipeline settles blocked with the reason surfaced verbatim", async () => {
    await seedRunningRun();
    const blocking: PostCompletionGitEffects = {
      ...createFakePostCompletionGitEffects(),
      beginIntegration: () =>
        Promise.resolve({ status: "blocked", reason: "the integration ref already exists" }),
    };

    const outcome = await run({
      units: [unit(UNIT_A)],
      registry: passingRegistry(),
      git: blocking,
    });

    expect(outcome.status).toBe("blocked");
    expect(runs.get(RUN_ID)?.runState).toBe("blocked");
    if (outcome.status !== "blocked") return;
    expect(outcome.reason).toBe("the integration ref already exists");
  });

  it("a CAS/integration block settles blocked and names the unit", async () => {
    await seedRunningRun();
    const blocking: PostCompletionGitEffects = {
      ...createFakePostCompletionGitEffects(),
      integrateCandidate: () =>
        Promise.resolve({ status: "blocked", reason: "cas_ref_update: exhausted" }),
    };

    const outcome = await run({
      units: [unit(UNIT_A)],
      registry: passingRegistry(),
      git: blocking,
    });

    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") return;
    expect(outcome.reason).toContain(UNIT_A);
    expect(outcome.reason).toContain("cas_ref_update: exhausted");
  });

  it("a refused publication settles FAILED, not blocked — the gates already passed", async () => {
    await seedRunningRun();
    const blocking: PostCompletionGitEffects = {
      ...createFakePostCompletionGitEffects(),
      publishCandidate: () =>
        Promise.resolve({ status: "blocked", reason: "git fetch exited 128" }),
    };

    const outcome = await run({
      units: [unit(UNIT_A)],
      registry: passingRegistry(),
      git: blocking,
    });

    expect(outcome.status).toBe("failed");
    expect(runs.get(RUN_ID)?.runState).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.reason).toContain("git fetch exited 128");
  });

  it("a unit whose worker changed nothing is skipped at integration, and the run still publishes", async () => {
    await seedRunningRun();
    const calls: string[] = [];
    const clean: PostCompletionGitEffects = {
      ...createFakePostCompletionGitEffects({ calls }),
      collectCandidate: (input) => {
        calls.push(`collect:${input.workUnit.id}`);
        return Promise.resolve(
          input.workUnit.id === UNIT_B
            ? { status: "nothing-to-commit" }
            : { status: "collected", objectId: "c".repeat(40) },
        );
      },
    };

    const outcome = await run({
      units: [unit(UNIT_A), unit(UNIT_B)],
      registry: passingRegistry(),
      git: clean,
    });

    expect(outcome.status).toBe("published");
    // Both were COLLECTED; only the one with work was INTEGRATED.
    expect(calls.filter((call) => call.startsWith("collect:"))).toHaveLength(2);
    expect(calls.filter((call) => call.startsWith("integrate:"))).toEqual([`integrate:${UNIT_A}`]);
  });

  it("a unit that succeeded but has no retained worktree fails the run rather than publishing without its work", async () => {
    await seedRunningRun();
    const outcome = await run({
      units: [unit(UNIT_A)],
      registry: passingRegistry(),
      // The retention map is empty — what a re-drive after a restart looks like.
      worktrees: new Map(),
    });

    expect(outcome.status).toBe("failed");
    expect(runs.get(RUN_ID)?.runState).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.reason).toContain(UNIT_A);
    expect(outcome.reason).toMatch(/worktree is not retained/i);
  });

  it("a unit the drive did not succeed contributes no candidate", async () => {
    await seedRunningRun();
    const calls: string[] = [];
    const outcome = await run({
      units: [unit(UNIT_A), unit(UNIT_B)],
      registry: passingRegistry(),
      git: createFakePostCompletionGitEffects({ calls }),
      // Only A succeeded; B is `failed`, so it must not be collected at all.
      statuses: new Map<string, WorkUnitAttemptStatus>([
        [UNIT_A, "succeeded"],
        [UNIT_B, "failed"],
      ]),
    });

    expect(outcome.status).toBe("published");
    expect(calls.filter((call) => call.startsWith("collect:"))).toEqual([`collect:${UNIT_A}`]);
  });
});

describe("a cancel racing the pipeline is stood down, never written over", () => {
  it("reports raced and leaves the cancelled state intact", async () => {
    await seedRunningRun();
    // `run.cancel` lands while the pipeline is between transitions — modelled by
    // cancelling inside the git seam, which the pipeline calls mid-walk.
    const cancelling: PostCompletionGitEffects = {
      ...createFakePostCompletionGitEffects(),
      collectCandidate: async (input) => {
        await transitionRun({
          journal,
          runs,
          runId: RUN_ID,
          changeSetId: CHANGE_SET_ID,
          to: "cancelled",
        });
        return {
          status: "collected",
          objectId: "b".repeat(40),
          ...(input.workUnit.id === "" ? {} : {}),
        };
      },
    };

    const outcome = await run({
      units: [unit(UNIT_A)],
      registry: passingRegistry(),
      git: cancelling,
    });

    expect(outcome.status).toBe("raced");
    // The cancel stands. A pipeline that fought it would leave `blocked`/`failed`.
    expect(runs.get(RUN_ID)?.runState).toBe("cancelled");
  });
});

describe("THE CENTRAL BINDING — the published artifact must be the verified one", () => {
  it("retracts the branch and FAILS when the published tip is not the candidate the gates passed", async () => {
    await seedRunningRun();
    const calls: string[] = [];
    // The publish reports a DIFFERENT object id from the one
    // `resolveIntegratedObjectId` handed the gate — exactly what probe D's
    // mutation produces, and what a mid-pipeline ref hijack would produce.
    const divergent: PostCompletionGitEffects = {
      ...createFakePostCompletionGitEffects({ calls }),
      publishCandidate: () =>
        Promise.resolve({
          status: "published",
          branchName: "chore/divergent",
          objectId: "d".repeat(40),
        }),
    };

    const outcome = await run({
      units: [unit(UNIT_A)],
      registry: passingRegistry(),
      git: divergent,
    });

    expect(outcome.status).toBe("failed");
    expect(runs.get(RUN_ID)?.runState).toBe("failed");
    expect(runs.get(RUN_ID)?.runState).not.toBe("published_local");
    if (outcome.status !== "failed") return;
    // Names BOTH ids, so the divergence is diagnosable rather than a bare refusal.
    expect(outcome.reason).toContain("d".repeat(40));
    expect(outcome.reason).toContain("chore/divergent");
    // RETRACTED, not merely failed: an unverified branch left in the user's repo
    // is worse than not publishing at all.
    expect(calls).toContain("retract:chore/divergent");
  });

  it("CONTROL — a matching tip publishes and retracts nothing", async () => {
    await seedRunningRun();
    const calls: string[] = [];
    const outcome = await run({
      units: [unit(UNIT_A)],
      registry: passingRegistry(),
      git: createFakePostCompletionGitEffects({ calls }),
    });

    expect(outcome.status).toBe("published");
    expect(runs.get(RUN_ID)?.runState).toBe("published_local");
    expect(calls.filter((call) => call.startsWith("retract:"))).toEqual([]);
  });
});

describe("errors that are not lifecycle outcomes", () => {
  it("RETHROWS a transition failure that is not an illegal-edge race", async () => {
    await seedRunningRun();
    // A journal/registry write failing is a genuine background problem, not an
    // absorbing-state race — it must NOT be laundered into a `raced` outcome.
    const exploding = {
      ...runs,
      upsert: () => {
        throw new Error("registry write exploded");
      },
    } as unknown as RunsRegistry;

    await expect(
      run({ units: [unit(UNIT_A)], registry: passingRegistry(), runsOverride: exploding }),
    ).rejects.toThrow("registry write exploded");
  });

  it("stringifies a non-Error thrown by the requirements resolver", async () => {
    await seedRunningRun();
    const hostile = {
      get: () => {
        throw "not an Error at all";
      },
      put: () => undefined,
      list: () => [],
      query: () => [],
    } as unknown as Registry<Requirement>;

    const outcome = await run({
      units: [unit(UNIT_A, { requirementIds: [REQ_ID] })],
      registry: passingRegistry(),
      requirementsOverride: hostile,
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.reason).toContain("not an Error at all");
  });

  it("stringifies a non-Error thrown by a gate handler", async () => {
    await seedRunningRun();
    const registry = createGateRegistry();
    registry.register("acceptance", "throws-a-string", () => {
      throw "gate threw a bare string";
    });

    const outcome = await run({ units: [unit(UNIT_A)], registry });

    expect(outcome.status).toBe("failed");
    expect(runs.get(RUN_ID)?.runState).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.reason).toContain("gate threw a bare string");
  });
});

describe("a cancel racing each pipeline transition stands the pipeline down", () => {
  /** Cancels the run from inside whichever git effect the pipeline calls next. */
  function cancelInside(
    where: keyof PostCompletionGitEffects,
    calls?: string[],
  ): PostCompletionGitEffects {
    const base = createFakePostCompletionGitEffects(calls === undefined ? {} : { calls });
    const cancel = async (): Promise<void> => {
      await transitionRun({
        journal,
        runs,
        runId: RUN_ID,
        changeSetId: CHANGE_SET_ID,
        to: "cancelled",
      });
    };
    if (where === "integrateCandidate") {
      return {
        ...base,
        integrateCandidate: async (input) => {
          const result = await base.integrateCandidate(input);
          await cancel();
          return result;
        },
      };
    }
    return {
      ...base,
      publishCandidate: async (input) => {
        const result = await base.publishCandidate(input);
        await cancel();
        return result;
      },
    };
  }

  it("before `verifying` — a run already cancelled is never dragged into the walk", async () => {
    await seedRunningRun();
    await transitionRun({
      journal,
      runs,
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      to: "cancelled",
    });

    const calls: string[] = [];
    const outcome = await run({
      units: [unit(UNIT_A)],
      registry: passingRegistry(),
      git: createFakePostCompletionGitEffects({ calls }),
    });

    expect(outcome.status).toBe("raced");
    if (outcome.status !== "raced") return;
    expect(outcome.reason).toContain("begin verification");
    expect(runs.get(RUN_ID)?.runState).toBe("cancelled");
    // Nothing was collected: the pipeline stood down before doing any work.
    expect(calls).toEqual([]);
  });

  it("before `final_verifying` — no gate fires and nothing publishes", async () => {
    await seedRunningRun();
    const calls: string[] = [];
    const outcome = await run({
      units: [unit(UNIT_A)],
      registry: passingRegistry(),
      git: cancelInside("integrateCandidate", calls),
    });

    expect(outcome.status).toBe("raced");
    if (outcome.status !== "raced") return;
    expect(outcome.reason).toContain("begin final verification");
    expect(runs.get(RUN_ID)?.runState).toBe("cancelled");
    expect(calls.filter((call) => call.startsWith("resolve:"))).toEqual([]);
    expect(calls.filter((call) => call.startsWith("publish:"))).toEqual([]);
  });

  it("before `published_local` — the cancel stands even though the branch was created", async () => {
    await seedRunningRun();
    const calls: string[] = [];
    const outcome = await run({
      units: [unit(UNIT_A)],
      registry: passingRegistry(),
      git: cancelInside("publishCandidate", calls),
    });

    expect(outcome.status).toBe("raced");
    if (outcome.status !== "raced") return;
    expect(outcome.reason).toContain("record publication");
    // The cancel is NOT overwritten with `published_local`.
    expect(runs.get(RUN_ID)?.runState).toBe("cancelled");
    expect(calls.filter((call) => call.startsWith("publish:"))).toHaveLength(1);
  });
});

describe("a run with nothing to integrate", () => {
  it("publishes an empty candidate, sourcing the branch slug from the ChangeSet's own rollback strategy", async () => {
    await seedRunningRun();
    // No work units at all — so `ordered[0]` is undefined and the slug source
    // falls back. Publishing anyway is the deliberate choice recorded in the
    // pipeline's doc comment: state-machine integrity first, and the branch
    // honestly records "verified, empty" rather than inventing a new terminal.
    const calls: string[] = [];
    const outcome = await run({
      units: [],
      changeSet: buildChangeSet({
        id: CHANGE_SET_ID,
        state: "ready",
        integrationOrder: [],
        rollbackStrategy: "revert the integration commit",
      }),
      registry: passingRegistry(),
      git: createFakePostCompletionGitEffects({ calls }),
    });

    expect(outcome.status).toBe("published");
    expect(runs.get(RUN_ID)?.runState).toBe("published_local");
    // The gate still fired against the ref's tip, which is the frozen base.
    expect(calls.filter((call) => call.startsWith("resolve:"))).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith("integrate:"))).toEqual([]);
    if (outcome.status !== "published") return;
    expect(outcome.objectId).toBe(BASE);
  });
});

describe("integrationOrderFor", () => {
  it("follows the ChangeSet's own integrationOrder", () => {
    const a = unit(UNIT_A);
    const b = unit(UNIT_B);
    expect(integrationOrderFor(changeSet([UNIT_B, UNIT_A]), [a, b]).map((u) => u.id)).toEqual([
      UNIT_B,
      UNIT_A,
    ]);
  });

  it("appends a succeeded unit the order never named rather than dropping its work", () => {
    const a = unit(UNIT_A);
    const b = unit(UNIT_B);
    // Only A is named. B must still integrate — dropping it would publish a
    // candidate that silently omits work the run reported as succeeded.
    expect(integrationOrderFor(changeSet([UNIT_A]), [a, b]).map((u) => u.id)).toEqual([
      UNIT_A,
      UNIT_B,
    ]);
  });

  it("ignores an id in the order that has no work unit, and never duplicates one", () => {
    const a = unit(UNIT_A);
    expect(
      integrationOrderFor(changeSet([UNIT_A, "99999999-9999-4999-8999-999999999999", UNIT_A]), [
        a,
      ]).map((u) => u.id),
    ).toEqual([UNIT_A]);
  });

  it("appends UNNAMED units in stable id order regardless of the order they arrive in", () => {
    const a = unit(UNIT_A);
    const b = unit(UNIT_B);
    // `integrationOrder` names neither, so both fall through to the stable
    // id-order tail. Supplied HIGH id first, so the comparator's `a.id > b.id`
    // arm decides — a plain "keep the input order" implementation would return
    // [B, A] and fail this.
    expect(integrationOrderFor(changeSet([]), [b, a]).map((u) => u.id)).toEqual([UNIT_A, UNIT_B]);
    expect(integrationOrderFor(changeSet([]), [a, b]).map((u) => u.id)).toEqual([UNIT_A, UNIT_B]);
  });

  it("dedupes a work unit supplied twice rather than integrating it twice", () => {
    const a = unit(UNIT_A);
    // A duplicated entry makes the comparator compare a unit with itself; the
    // `seen` set is what stops the same candidate integrating twice, which would
    // preflight it against a tip that already contains it.
    expect(integrationOrderFor(changeSet([]), [a, a]).map((u) => u.id)).toEqual([UNIT_A]);
  });
});

describe("deriveBranchType", () => {
  it("maps a security-section requirement to `security`, outranking everything else", () => {
    expect(
      deriveBranchType(
        [buildRequirement({ id: REQ_ID, section: "security" })],
        [unit(UNIT_A, { role: "docs" })],
      ),
    ).toBe("security");
  });

  it("maps a performance-section requirement to `perf`", () => {
    expect(
      deriveBranchType([buildRequirement({ id: REQ_ID, section: "performance" })], [unit(UNIT_A)]),
    ).toBe("perf");
  });

  it("uses a role that happens to be a branch type verbatim", () => {
    expect(deriveBranchType([], [unit(UNIT_A, { role: "docs" })])).toBe("docs");
  });

  it("falls back to the NEUTRAL `chore`, never an invented `feat`", () => {
    // `implementation` is the common role and is not a branch type. Claiming
    // `feat` would assert something the ChangeSet does not express.
    expect(deriveBranchType([], [unit(UNIT_A, { role: "implementation" })])).toBe("chore");
  });
});

describe("commitFieldsFor", () => {
  it("sources every field from already-produced structured values, and distinguishes the two stages", () => {
    const workUnit = unit(UNIT_A, {
      role: "implementation",
      title: "add the login form",
      ownedPaths: ["src/login/"],
      requirementIds: [REQ_ID],
    });
    const cs = buildChangeSet({
      id: CHANGE_SET_ID,
      state: "ready",
      rollbackStrategy: "revert the integration commit",
    });

    const collect = commitFieldsFor({
      workUnit,
      changeSet: cs,
      branchType: "chore",
      stage: "collect",
    });
    expect(collect.outcome).toBe("add the login form");
    expect(collect.type).toBe("chore");
    expect(collect.why).toContain("implementation");
    expect(collect.why).toContain("1 declared requirement");
    expect(collect.risk).toContain("revert the integration commit");
    expect(collect.compat).toContain("src/login/");

    const integrate = commitFieldsFor({
      workUnit,
      changeSet: cs,
      branchType: "chore",
      stage: "integrate",
    });
    // The one field that legitimately differs: the two commits were verified
    // differently at the moment each was made.
    expect(integrate.verification).not.toBe(collect.verification);
    expect(integrate.verification).toContain("preflighted");
  });
});
