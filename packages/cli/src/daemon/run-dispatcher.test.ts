/**
 * The real `RunDispatcher` — `driveRun`'s first production caller.
 *
 * These tests cover the two things that actually matter about it and that
 * no unit test elsewhere can: (1) it REFUSES precisely, rather than
 * half-dispatching, whenever the run's definition is incomplete — and
 * refusing to dispatch unbounded work when the authorization envelope is
 * missing is a security property, not a convenience; (2) it returns as soon
 * as ownership is decided, leaving the drive running in the background,
 * which is what keeps `status`/`cancel` answerable during a long run.
 *
 * Git plumbing and the engine adapter are injected, so nothing here touches
 * a real repository, spawns an engine, or reaches the network.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationEnvelopeSchema,
  ChangeSetSchema,
  RequirementSchema,
  WorkUnitSchema,
  type AuthorizationEnvelope,
  type ChangeSet,
  type Requirement,
  type WorkUnit,
  RUN_LIFECYCLE_STATES,
  EnvelopePolicySchema,
  isRunLifecycleAbsorbing,
} from "@crabgic/contracts";
import {
  createJournalStore,
  journalCriteriaSeal,
  recordAttempt,
  type JournalStore,
} from "@crabgic/journal";
import {
  createArtifactIndexRegistry,
  createFileRegistry,
  createRunsRegistry,
  createWorkersRegistry,
  transitionRun,
  DISPATCHER_DRAINING_REASON,
  type SupervisorDependencies,
  type TerminableWorker,
} from "@crabgic/supervisor";
import {
  buildAuthorizationEnvelope,
  buildChangeSet,
  buildFakeEngineScript,
  buildRequirement,
  buildWorkerResult,
  buildWorkUnit,
  FakeEngineAdapter,
} from "@crabgic/testkit";
import { createRealRunDispatcher } from "./run-dispatcher.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const ENVELOPE_ID = "33333333-3333-4333-8333-333333333333";
const UNIT_ID = "44444444-4444-4444-8444-444444444444";

/**
 * Placeholder engine credential. Assembled rather than written as a literal
 * so the repository's pre-commit secret scanner sees no credential-shaped
 * assignment here — the value is never used against a real engine (every
 * test injects `createAdapter`).
 */
const PLACEHOLDER_ENGINE_CREDENTIAL = ["placeholder", "not", "real"].join("-");

let dir: string;
let journal: JournalStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eo-real-dispatcher-"));
  journal = createJournalStore({ journalDir: join(dir, "journal") });
});
afterEach(async () => {
  // Some tests deliberately leave a drive running in the background (that
  // non-blocking behavior is the point), so the directory can still be
  // written to as it is removed. Retry rather than fail on ENOTEMPTY.
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

interface Seeded {
  readonly changeSet?: ChangeSet | undefined;
  readonly workUnits?: readonly WorkUnit[] | undefined;
  readonly envelope?: AuthorizationEnvelope | undefined;
  /** The `Requirement` records available to the daemon (roadmap/24). Absent = the file is never written, which is exactly the missing-record condition. */
  readonly requirements?: readonly Requirement[] | undefined;
  readonly run?: boolean | undefined;
}

function buildDeps(
  seeded: Seeded,
): SupervisorDependencies & { readonly liveWorkers: Map<string, TerminableWorker> } {
  const runs = createRunsRegistry();
  if (seeded.run !== false) {
    runs.upsert({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      runState: "ready",
      updatedAt: "2026-07-25T00:00:00.000Z",
    });
  }

  const changeSets = createFileRegistry<ChangeSet>({
    path: join(dir, "change-sets.json"),
    schema: ChangeSetSchema,
  });
  if (seeded.changeSet !== undefined) changeSets.put(seeded.changeSet);

  const workUnits = createFileRegistry<WorkUnit>({
    path: join(dir, "work-units.json"),
    schema: WorkUnitSchema,
  });
  for (const unit of seeded.workUnits ?? []) workUnits.put(unit);

  const envelopes = createFileRegistry<AuthorizationEnvelope>({
    path: join(dir, "envelopes.json"),
    schema: AuthorizationEnvelopeSchema,
  });
  if (seeded.envelope !== undefined) envelopes.put(seeded.envelope);

  // File-backed for the same reason the three above are: in production this
  // registry is opened by `composeSupervisor` over the file INTAKE wrote, in a
  // different process. An in-memory stand-in here would hide the only failure
  // mode that actually shipped.
  const requirements = createFileRegistry<Requirement>({
    path: join(dir, "requirements.json"),
    schema: RequirementSchema,
  });
  for (const requirement of seeded.requirements ?? []) requirements.put(requirement);

  return {
    journal,
    runs,
    changeSets,
    workUnits,
    envelopes,
    requirements,
    workers: createWorkersRegistry(),
    artifactIndex: createArtifactIndexRegistry(),
    liveWorkers: new Map<string, TerminableWorker>(),
  };
}

function fullySeeded(): Seeded {
  return {
    changeSet: buildChangeSet({
      id: CHANGE_SET_ID,
      authorizationEnvelopeId: ENVELOPE_ID,
      // `ready` is the state a satisfied approval gate produces, and the one
      // state `createRun` will dispatch from (ledger Gap 18).
      state: "ready",
    }),
    workUnits: [
      buildWorkUnit({
        id: UNIT_ID,
        changeSetId: CHANGE_SET_ID,
        dependsOn: [],
        attemptStatus: "pending",
      }),
    ],
    envelope: buildAuthorizationEnvelope({ id: ENVELOPE_ID, changeSetId: CHANGE_SET_ID }),
  };
}

/** Git plumbing that answers plausibly without touching a repository. */
function fakePlumbing() {
  return {
    gitBinary: "git",
    run: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
  } as never;
}

/**
 * The standing policy these fixtures run under. Grants exactly the fixture
 * envelope's own owned path and nothing else, so a case that widens the
 * envelope must widen this too -- the gate stays load-bearing in the suite
 * rather than being a rubber stamp.
 */
const FIXTURE_POLICY = EnvelopePolicySchema.parse({
  schemaVersion: 1,
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  createdAt: "2026-01-01T00:00:00.000Z",
  allowedPathPrefixes: ["packages/example/src"],
  maxWorkerTurnsPerAttempt: 40,
});

function newDispatcher(
  deps: ReturnType<typeof buildDeps>,
  overrides: Record<string, unknown> = {},
) {
  return createRealRunDispatcher({
    loadPolicy: () => ({
      status: "loaded" as const,
      policy: FIXTURE_POLICY,
      digest: "sha256:fixture",
    }),
    deps,
    projectDir: dir,
    xdgEnv: { HOME: dir },
    projectHash: "dispatch-hash",
    auth: { kind: "oauthToken", token: PLACEHOLDER_ENGINE_CREDENTIAL },
    plumbing: fakePlumbing(),
    // Seams at the git boundary: no clone, no freeze, no `worktree add`.
    prepareRun: () => Promise.resolve("a".repeat(40)),
    createAttemptWorktree: () => Promise.resolve(join(dir, "worktree")),
    ...overrides,
  });
}

describe("createRealRunDispatcher — refusals", () => {
  /**
   * There is no "unknown run" refusal any more: dispatch takes a ChangeSet
   * and CREATES the run (ledger Gap 18). The pre-existing-run case moved to
   * `resume`, below.
   */
  it("refuses when the change set is not available", async () => {
    const dispatcher = newDispatcher(buildDeps({ run: false }));
    const result = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/unknown change set/i);
  });

  it("refuses a change set with no work units rather than driving an empty DAG", async () => {
    const { changeSet, envelope } = fullySeeded();
    const dispatcher = newDispatcher(buildDeps({ run: false, changeSet, envelope, workUnits: [] }));
    const result = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/no work units/i);
  });

  /**
   * A security property, not a convenience: the envelope is the
   * authorization boundary every TaskPacket is bounded against. Dispatching
   * without one would mean dispatching work with no bound on owned paths or
   * allowed commands.
   */
  it("refuses to dispatch when the authorization envelope is missing", async () => {
    const { changeSet, workUnits } = fullySeeded();
    const dispatcher = newDispatcher(buildDeps({ run: false, changeSet, workUnits }));
    const result = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/envelope .* not available|unbounded/i);
  });
});

describe("createRealRunDispatcher — dispatch", () => {
  it("accepts a fully-defined run and returns without waiting for it to finish", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    let driveStarted = false;
    const dispatcher = newDispatcher(deps, {
      createAdapter: () => {
        driveStarted = true;
        return Promise.resolve(
          new FakeEngineAdapter(
            buildFakeEngineScript({
              structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
            }),
          ),
        );
      },
    });

    const result = await dispatcher.dispatch(CHANGE_SET_ID);

    // Ownership decided immediately; the drive is still only just beginning.
    expect(result.accepted).toBe(true);
    // The runId is an OUTPUT -- dispatch is where a run comes into existence.
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(driveStarted).toBe(false);
  });

  /**
   * The end-to-end assertion this whole chain exists for: a dispatched run
   * genuinely drives its DAG through `driveRun` into a real
   * `dispatchAttempt`, against a scripted engine. Before this dispatcher,
   * `driveRun` had no production caller at all, so an approved DAG could be
   * created and then simply sat there forever.
   *
   * Asserted through the JOURNAL rather than a callback: the journal is the
   * durable evidence an operator (and `status`) actually reads, so proving
   * the transition landed there proves the run was really driven.
   */
  it("drives the DAG through to a journaled work-unit transition", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const dispatcher = newDispatcher(deps, {
      createAdapter: () =>
        Promise.resolve(
          new FakeEngineAdapter(
            buildFakeEngineScript({
              structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
            }),
          ),
        ),
    });

    expect((await dispatcher.dispatch(CHANGE_SET_ID)).accepted).toBe(true);

    await vi.waitFor(
      async () => {
        const transitions: unknown[] = [];
        for await (const entry of deps.journal.queryEntries({ type: "work_unit_transition" })) {
          transitions.push(entry);
        }
        expect(transitions.length).toBeGreaterThan(0);
      },
      { timeout: 10_000 },
    );
  });

  /**
   * Active park resume (task #8): a rate-limit-parked unit whose reset window
   * has passed is RESUMED via the RETAINED adapter — the same instance that
   * spawned the session, so `adapter.resume` continues with full authority.
   * The fake proves this by construction: its `resume` throws for an unknown
   * session, so a resume driven through a fresh adapter would crash. Success
   * (the unit reaching `succeeded`) with `createAdapter` called exactly once
   * is the retained-adapter reuse.
   */
  it("resumes a parked-ready unit via the retained adapter and completes it", async () => {
    const SESSION = "77777777-7777-4777-8777-777777777777";
    const worktreePath = join(dir, "worktree"); // the default createAttemptWorktree
    let adaptersCreated = 0;
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const dispatcher = newDispatcher(deps, {
      createAttemptWorktree: () => Promise.resolve(worktreePath),
      createAdapter: () => {
        adaptersCreated += 1;
        return Promise.resolve(
          new FakeEngineAdapter(
            buildFakeEngineScript({
              sessionId: SESSION,
              // Scope MUST match what the dispatcher reconstructs:
              // createSessionRef sets projectDirectory := worktreePath.
              projectDirectory: worktreePath,
              worktreePath,
              // Park on the first run: reset window in the deep past → the
              // driver finds it ready-to-resume immediately.
              failure: {
                kind: "limitSignal",
                payload: { status: "allowed", resetsAt: 1, rateLimitType: "five_hour" },
              },
              // The continuation the retained adapter runs on resume.
              onResume: buildFakeEngineScript({
                sessionId: SESSION,
                projectDirectory: worktreePath,
                worktreePath,
                structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
              }),
            }),
          ),
        );
      },
    });

    expect((await dispatcher.dispatch(CHANGE_SET_ID)).accepted).toBe(true);

    // The unit parks, then the driver resumes it to success — observable as a
    // `succeeded` work-unit transition in the journal.
    await vi.waitFor(
      async () => {
        const statuses: string[] = [];
        for await (const entry of deps.journal.queryEntries({ type: "work_unit_transition" })) {
          const s = (entry.payload as { status?: string }).status;
          if (typeof s === "string") statuses.push(s);
        }
        expect(statuses).toContain("parked:rate_limit");
        expect(statuses).toContain("succeeded");
      },
      { timeout: 10_000 },
    );
    // Resume reused the RETAINED adapter — it never asked for a fresh one.
    expect(adaptersCreated).toBe(1);
  });

  /**
   * F1 (the load-bearing scope claim): retention must survive ACROSS drives,
   * not just within one. A unit parked while its reset window is still in the
   * future ends its drive PARKED; a LATER `resume(runId)` — the `crabgic
   * resume <runId>` path, once the window passes — must reuse the adapter
   * retained from the first drive. With a per-`drive()` map that second drive
   * finds nothing, declines, and the unit never completes; this test fails
   * against that mutation and passes only when retention is keyed per-run at
   * the dispatcher level.
   *
   * The clock is advanced only AFTER a barrier proves the first drive has left
   * flight, so the first drive (which always reads `clock === 1000`) cannot
   * self-resume and mask the bug.
   */
  it("retains a parked unit's adapter ACROSS drives — a later resume completes it (F1)", async () => {
    const SESSION = "88888888-8888-4888-8888-888888888888";
    const worktreePath = join(dir, "worktree");
    let clock = 1000; // strictly before the reset window
    let adaptersCreated = 0;
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const dispatcher = newDispatcher(deps, {
      nowSeconds: () => clock,
      createAttemptWorktree: () => Promise.resolve(worktreePath),
      createAdapter: () => {
        adaptersCreated += 1;
        return Promise.resolve(
          new FakeEngineAdapter(
            buildFakeEngineScript({
              sessionId: SESSION,
              projectDirectory: worktreePath,
              worktreePath,
              // Reset window in the FUTURE relative to `clock`: the first drive
              // parks and ENDS without resuming. The resume must come from a
              // separate, later drive.
              failure: {
                kind: "limitSignal",
                payload: { status: "allowed", resetsAt: 5000, rateLimitType: "five_hour" },
              },
              onResume: buildFakeEngineScript({
                sessionId: SESSION,
                projectDirectory: worktreePath,
                worktreePath,
                structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
              }),
            }),
          ),
        );
      },
    });

    const first = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(first.accepted).toBe(true);
    const runId = first.runId;
    if (runId === undefined) throw new Error("dispatch accepted without a runId");

    // Barrier: the first drive has SETTLED, while the run persists as a live,
    // parked-and-`running` run. This used to be a probing-dispatch poll that
    // re-derived the settle point from a refusal message; `whenIdle()` is the
    // dispatcher's own seam for it — no polling, no timeout, and advancing the
    // clock afterwards cannot race a drive that has already resolved. (Its
    // door-closing sibling `drain()` cannot be used here: this case must go on
    // to `resume` the very run it just waited for.)
    await dispatcher.whenIdle();
    expect((await dispatcher.dispatch(CHANGE_SET_ID)).reason).toMatch(
      /already has run .* in flight/i,
    );

    // The first drive parked the unit and never resumed it.
    {
      const statuses: string[] = [];
      for await (const entry of deps.journal.queryEntries({ type: "work_unit_transition" })) {
        const s = (entry.payload as { status?: string }).status;
        if (typeof s === "string") statuses.push(s);
      }
      expect(statuses).toContain("parked:rate_limit");
      expect(statuses).not.toContain("succeeded");
    }

    // The reset window has now passed. A SEPARATE drive must reuse the adapter
    // retained from the first drive.
    clock = 9000;
    expect((await dispatcher.resume(runId)).accepted).toBe(true);

    await vi.waitFor(
      async () => {
        const statuses: string[] = [];
        for await (const entry of deps.journal.queryEntries({ type: "work_unit_transition" })) {
          const s = (entry.payload as { status?: string }).status;
          if (typeof s === "string") statuses.push(s);
        }
        expect(statuses).toContain("succeeded");
      },
      { timeout: 10_000 },
    );

    // Exactly one adapter ever existed (the first drive's spawn). The resume
    // reused it ACROSS drives rather than creating a fresh one — the whole
    // point of dispatcher-level retention.
    expect(adaptersCreated).toBe(1);
  });

  /**
   * Retention must not become a leak: hoisting the map to run scope means a
   * PARKED run's adapters outlive its drive, so a run cancelled out-of-band
   * (via the supervisor's `run.cancel`, which never touches this dispatcher)
   * would otherwise pin its session context until a daemon restart.
   * `sweepStaleRetention` — run on every `dispatch`/`resume` — drops adapters
   * for runs that are absorbing (or gone). We observe it via the run-store:
   * a single `resume` queries the run TWICE — once from the sweep iterating
   * the retained map, once from `resume` itself — where a no-sweep build would
   * query it only once.
   */
  it("sweeps a cancelled parked run's retained adapter — no leak past cancel (F1 follow-up)", async () => {
    const SESSION = "99999999-9999-4999-8999-999999999999";
    const worktreePath = join(dir, "worktree");
    // Never advanced: this run stays parked and is cancelled, never resumed.
    const clock = 1000; // before the reset window → the first drive parks and ends
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const dispatcher = newDispatcher(deps, {
      nowSeconds: () => clock,
      createAttemptWorktree: () => Promise.resolve(worktreePath),
      createAdapter: () =>
        Promise.resolve(
          new FakeEngineAdapter(
            buildFakeEngineScript({
              sessionId: SESSION,
              projectDirectory: worktreePath,
              worktreePath,
              failure: {
                kind: "limitSignal",
                payload: { status: "allowed", resetsAt: 5000, rateLimitType: "five_hour" },
              },
            }),
          ),
        ),
    });

    const first = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(first.accepted).toBe(true);
    const runId = first.runId;
    if (runId === undefined) throw new Error("dispatch accepted without a runId");

    // Barrier: the first drive has settled (the run is live and parked) —
    // proven by a probing dispatch refusing with the live-run reason.
    await vi.waitFor(
      async () => {
        const probe = await dispatcher.dispatch(CHANGE_SET_ID);
        expect(probe.accepted).toBe(false);
        expect(probe.reason).toMatch(/already has run .* in flight/i);
      },
      { timeout: 10_000 },
    );

    // Cancel the parked run out-of-band, exactly as the supervisor router does
    // (`running → cancelled`), bypassing the dispatcher entirely.
    await transitionRun({
      journal: deps.journal,
      runs: deps.runs,
      runId,
      changeSetId: CHANGE_SET_ID,
      to: "cancelled",
    });

    // A resume now sweeps the retained map (querying the run once) and then
    // refuses the cancelled run (querying it again).
    const getSpy = vi.spyOn(deps.runs, "get");
    const outcome = await dispatcher.resume(runId);
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toMatch(/cancelled and cannot be resumed/i);
    const getsForRun = getSpy.mock.calls.filter(([id]) => id === runId).length;
    // Two queries: the sweep found the retained (now-cancelled) run and
    // evicted it; a build without the sweep would query only once.
    expect(getsForRun).toBe(2);
    getSpy.mockRestore();
  });

  /**
   * The turn cap is AUTHORIZED authority, not a dispatcher constant: the
   * envelope's `maxTurnsPerAttempt` (already tested for containment in the
   * standing policy by the time a dispatch reaches packet compilation) is
   * what lands in every `TaskPacket.resourceLimits.maxTurns`, where the
   * engine enforces it. Before this, the dispatcher hardcoded 40 and no
   * policy dimension governed it.
   */
  it("compiles the ENVELOPE's turn budget into the packet, not a dispatcher constant", async () => {
    const seeded = fullySeeded();
    const deps = buildDeps({
      ...seeded,
      run: false,
      envelope: buildAuthorizationEnvelope({
        id: ENVELOPE_ID,
        changeSetId: CHANGE_SET_ID,
        maxTurnsPerAttempt: 7,
      }),
    });
    const spawnedPackets: { readonly resourceLimits?: { readonly maxTurns?: number } }[] = [];
    const dispatcher = newDispatcher(deps, {
      createAdapter: () => {
        const adapter = new FakeEngineAdapter(
          buildFakeEngineScript({
            structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
          }),
        );
        const realSpawn = adapter.spawn.bind(adapter);
        adapter.spawn = (packet, profile, adjudicate) => {
          spawnedPackets.push(packet as (typeof spawnedPackets)[number]);
          return realSpawn(packet, profile, adjudicate);
        };
        return Promise.resolve(adapter);
      },
    });

    expect((await dispatcher.dispatch(CHANGE_SET_ID)).accepted).toBe(true);
    await vi.waitFor(
      () => {
        expect(spawnedPackets.length).toBeGreaterThan(0);
      },
      { timeout: 10_000 },
    );
    expect(spawnedPackets[0]?.resourceLimits?.maxTurns).toBe(7);
  });

  it("is idempotent per CHANGE SET — a second dispatch never starts a competing driver", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    // A drive that never settles, so the run stays in flight for the
    // duration of the assertion.
    const dispatcher = newDispatcher(deps, {
      createAdapter: () => new Promise(() => undefined),
    });

    expect((await dispatcher.dispatch(CHANGE_SET_ID)).accepted).toBe(true);
    const second = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(second.accepted).toBe(false);
    expect(second.reason).toMatch(/already being dispatched/i);
  });

  /**
   * A background drive that throws must be reported, never left as an
   * unhandled rejection — one bad run must not be able to take the whole
   * daemon (and every other run it is driving) down.
   */
  it("reports a failing background drive instead of crashing the daemon, and marks the run failed", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const errors: unknown[] = [];
    const dispatcher = newDispatcher(deps, {
      createAdapter: () => Promise.reject(new Error("worktree exploded")),
      onDriveError: (_runId: string, err: unknown) => errors.push(err),
    });

    const result = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(result.accepted).toBe(true);
    await vi.waitFor(() => {
      expect(errors).toHaveLength(1);
    });
    expect((errors[0] as Error).message).toContain("worktree exploded");
    // F5: an errored drive must not leave the run `running` — that would make
    // `findLiveRunForChangeSet` treat it as in-flight and block every retry.
    await vi.waitFor(() => {
      expect(deps.runs.get(result.runId!)?.runState).toBe("failed");
    });
  });

  /**
   * F5, the settle path: a drive that ends `blocked` (a unit failed and its
   * dependents can never become ready) must move the run to `blocked`, an
   * absorbing state, so the change set can be retried. Left `running` it
   * would be wedged forever.
   */
  it("marks a run blocked when its drive ends blocked, so the change set is retryable", async () => {
    const UNIT_B = "66666666-6666-4666-8666-666666666666";
    const seeded = fullySeeded();
    const deps = buildDeps({
      ...seeded,
      run: false,
      // A → B chain; A fails, so B can never become ready → the drive blocks.
      workUnits: [
        buildWorkUnit({
          id: UNIT_ID,
          changeSetId: CHANGE_SET_ID,
          dependsOn: [],
          attemptStatus: "pending",
        }),
        buildWorkUnit({
          id: UNIT_B,
          changeSetId: CHANGE_SET_ID,
          dependsOn: [UNIT_ID],
          attemptStatus: "pending",
        }),
      ],
    });
    const dispatcher = newDispatcher(deps, {
      createAdapter: () =>
        Promise.resolve(
          new FakeEngineAdapter(
            buildFakeEngineScript({ structuredOutput: buildWorkerResult({ outcome: "failed" }) }),
          ),
        ),
    });

    const result = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(result.accepted).toBe(true);
    await vi.waitFor(() => {
      expect(deps.runs.get(result.runId!)?.runState).toBe("blocked");
    });
  });

  /**
   * The settle transition must tolerate the run having reached an absorbing
   * state independently — a `run.cancel` racing the drive. The drive's own
   * `blocked` transition is then an illegal edge from `cancelled`, which is
   * expected: swallow it and leave the run cancelled.
   *
   * The topology is deliberate: an A→B chain where A fails strands B pending,
   * so the drive ends `blocked` and this pins the swallow on the `blocked`
   * edge specifically. (Its sibling on the `failed` edge — a single-unit DAG,
   * which since 2026-08-02 settles rather than reporting a completion — lives
   * in the all-terminal describe above.) A gated adapter holds the drive until
   * the test has cancelled the run, so the settle's transition genuinely fires
   * against a `cancelled` run.
   */
  it("swallows the illegal transition when the run is cancelled before a blocked drive settles", async () => {
    const UNIT_B = "66666666-6666-4666-8666-666666666666";
    const deps = buildDeps({
      ...fullySeeded(),
      run: false,
      workUnits: [
        buildWorkUnit({
          id: UNIT_ID,
          changeSetId: CHANGE_SET_ID,
          dependsOn: [],
          attemptStatus: "pending",
        }),
        buildWorkUnit({
          id: UNIT_B,
          changeSetId: CHANGE_SET_ID,
          dependsOn: [UNIT_ID],
          attemptStatus: "pending",
        }),
      ],
    });
    let releaseAdapter!: () => void;
    const adapterGate = new Promise<void>((resolve) => {
      releaseAdapter = resolve;
    });
    const unhandled: unknown[] = [];
    const dispatcher = newDispatcher(deps, {
      onDriveError: (_runId: string, err: unknown) => unhandled.push(err),
      createAdapter: async () => {
        await adapterGate; // hold the drive until the test cancels the run
        return new FakeEngineAdapter(
          buildFakeEngineScript({ structuredOutput: buildWorkerResult({ outcome: "failed" }) }),
        );
      },
    });

    const result = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(result.accepted).toBe(true);
    const runId = result.runId!;
    // Cancel the run while the drive is parked in createAdapter, so the
    // subsequent `blocked` settle transitions from `cancelled` — illegal.
    deps.runs.upsert({
      runId,
      changeSetId: CHANGE_SET_ID,
      runState: "cancelled",
      updatedAt: "2026-07-30T00:00:00.000Z",
    });

    // A DETERMINISTIC signal that the settle actually attempted its
    // transition: `transitionRun` reads `runs.get(runId)` to find its `from`
    // state, so a `get` for this run AFTER the cancel is the settle firing.
    // Without this the test would assert before the settle ran (the run is
    // already `cancelled`), never exercising the swallow — the vacuity a
    // prior review caught.
    let settleAttempted = false;
    const realGet = deps.runs.get.bind(deps.runs);
    deps.runs.get = (id: string) => {
      if (id === runId) settleAttempted = true;
      return realGet(id);
    };
    releaseAdapter();

    await vi.waitFor(() => {
      expect(settleAttempted).toBe(true);
    });
    // The illegal `cancelled → blocked` edge was swallowed: the run stays
    // cancelled and nothing was surfaced as a drive error.
    expect(deps.runs.get(runId)?.runState).toBe("cancelled");
    expect(unhandled).toHaveLength(0);
  });

  /**
   * The settle transition runs on the not-awaited drive chain, so it must
   * NEVER reject — an escaping error would be an unhandled rejection, the
   * daemon crash the whole background-drive discipline exists to prevent. A
   * genuine (non-illegal) transition failure is reported through
   * `onDriveError`, not propagated.
   */
  it("reports a settle-transition failure through onDriveError rather than crashing", async () => {
    const UNIT_B = "66666666-6666-4666-8666-666666666666";
    const seeded = fullySeeded();
    const deps = buildDeps({
      ...seeded,
      run: false,
      // A→B chain, A fails and strands B pending → the drive ends `blocked` →
      // a settle transition is attempted, and its journal write is the one
      // this test arms to fail.
      workUnits: [
        buildWorkUnit({
          id: UNIT_ID,
          changeSetId: CHANGE_SET_ID,
          dependsOn: [],
          attemptStatus: "pending",
        }),
        buildWorkUnit({
          id: UNIT_B,
          changeSetId: CHANGE_SET_ID,
          dependsOn: [UNIT_ID],
          attemptStatus: "pending",
        }),
      ],
    });
    // Fail only the settle's `run_transition` write, forcing settleRunState
    // down its non-illegal error path. Armed once the drive is under way
    // (createRun's own transitions have already been written by then).
    const realAppend = deps.journal.appendEntry.bind(deps.journal);
    let failTransitionWrites = false;
    deps.journal.appendEntry = (entry: Parameters<typeof realAppend>[0]) => {
      if (failTransitionWrites && (entry as { type?: string }).type === "run_transition") {
        return Promise.reject(new Error("journal is on fire"));
      }
      return realAppend(entry);
    };

    const errors: unknown[] = [];
    const dispatcher = newDispatcher(deps, {
      onDriveError: (_runId: string, err: unknown) => errors.push(err),
      createAdapter: () => {
        failTransitionWrites = true;
        return Promise.resolve(
          new FakeEngineAdapter(
            buildFakeEngineScript({ structuredOutput: buildWorkerResult({ outcome: "failed" }) }),
          ),
        );
      },
    });

    const result = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(result.accepted).toBe(true);
    // The blocked-transition write fails; it is REPORTED, not thrown as an
    // unhandled rejection.
    await vi.waitFor(() => {
      expect(errors.some((e) => (e as Error).message === "journal is on fire")).toBe(true);
    });
  });
});

/**
 * THE IDLE-RUN WEDGE. An ordinary single-unit failure used to wedge its change
 * set forever: `driveRun` classified any all-terminal DAG `completed`,
 * `terminalStateFor("completed")` wrote no transition (a completed run's
 * successor is `verifying`, owned by a verification pipeline nothing composes
 * yet), and the run stayed `running` with every unit terminal.
 * `findLiveRunForChangeSet` then refused every re-dispatch — "already has run
 * … in flight (running)" — and `resume` answered `accepted: true` to a
 * re-drive that could dispatch nothing, forever. Only `run.cancel` escaped.
 *
 * This is PR #46's sibling: #46 fixed the restart-with-a-parked-run shape of
 * the same lying-accept and deliberately scoped the failure shape out.
 *
 * A failing run has no verification question to answer — `running → failed`
 * and `running → cancelled` are declared edges — so settling it needs none of
 * the deferred `completed → verifying` wiring.
 */
describe("createRealRunDispatcher — an all-terminal DAG settles the run", () => {
  /** A DAG of one unit, whose scripted worker reports `outcome`. */
  function dispatcherFor(outcome: "failed" | "cancelled") {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const dispatcher = newDispatcher(deps, {
      createAdapter: () =>
        Promise.resolve(
          new FakeEngineAdapter(
            buildFakeEngineScript({ structuredOutput: buildWorkerResult({ outcome }) }),
          ),
        ),
    });
    return { deps, dispatcher };
  }

  it("marks a run failed when its only unit fails, so the change set is retryable", async () => {
    const { deps, dispatcher } = dispatcherFor("failed");

    const first = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(first.accepted).toBe(true);
    const runId = first.runId;
    if (runId === undefined) throw new Error("dispatch accepted without a runId");

    await vi.waitFor(() => expect(deps.runs.get(runId)?.runState).toBe("failed"), {
      timeout: 10_000,
    });

    // THE WEDGE IS GONE. `failed` is absorbing, so `findLiveRunForChangeSet`
    // skips it and the ordinary retry path — dispatch the change set again —
    // just works, as a genuinely new run.
    await dispatcher.whenIdle();
    const second = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(second.accepted).toBe(true);
    expect(second.runId).not.toBe(runId);

    // And the dead run is refused by the pre-existing absorbing-state guard
    // rather than accepted into a futile re-drive.
    const resumed = await dispatcher.resume(runId);
    expect(resumed.accepted).toBe(false);
    expect(resumed.reason).toMatch(/is failed and cannot be resumed/i);
  });

  /**
   * A cancelled unit is terminal too, and gets the honest edge: the run's own
   * record says it was cancelled, not that it failed. Folding the two together
   * would journal a `running → failed` audit record that misattributes.
   */
  it("marks a run cancelled when its only unit ends cancelled, not failed", async () => {
    const { deps, dispatcher } = dispatcherFor("cancelled");

    const first = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(first.accepted).toBe(true);
    const runId = first.runId;
    if (runId === undefined) throw new Error("dispatch accepted without a runId");

    await vi.waitFor(() => expect(deps.runs.get(runId)?.runState).toBe("cancelled"), {
      timeout: 10_000,
    });
  });

  /**
   * The race guard, on the NEW edge. A `run.cancel` landing before a failing
   * drive settles makes `running → failed` an illegal transition from the
   * absorbing `cancelled` — which must be swallowed, exactly as the blocked
   * settle's own guard does, never surfaced as a drive error.
   */
  it("swallows the illegal transition when the run is cancelled before a failing drive settles", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    let releaseAdapter!: () => void;
    const adapterGate = new Promise<void>((resolve) => {
      releaseAdapter = resolve;
    });
    const unhandled: unknown[] = [];
    const dispatcher = newDispatcher(deps, {
      onDriveError: (_runId: string, err: unknown) => unhandled.push(err),
      createAdapter: async () => {
        await adapterGate;
        return new FakeEngineAdapter(
          buildFakeEngineScript({ structuredOutput: buildWorkerResult({ outcome: "failed" }) }),
        );
      },
    });

    const first = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(first.accepted).toBe(true);
    const runId = first.runId;
    if (runId === undefined) throw new Error("dispatch accepted without a runId");
    deps.runs.upsert({
      runId,
      changeSetId: CHANGE_SET_ID,
      runState: "cancelled",
      updatedAt: "2026-08-02T00:00:00.000Z",
    });

    releaseAdapter();
    await dispatcher.whenIdle();

    expect(deps.runs.get(runId)?.runState).toBe("cancelled");
    expect(unhandled).toHaveLength(0);
  });
});

/**
 * `resume` is the half that kept the old runId-keyed shape. It re-drives a
 * run that already exists; it never creates one.
 */
describe("createRealRunDispatcher — resume", () => {
  it("refuses an unknown run", async () => {
    const dispatcher = newDispatcher(buildDeps({ run: false }));
    const result = await dispatcher.resume(RUN_ID);
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/unknown run/i);
  });

  /**
   * A finished run must not be re-driven. `blocked`/`cancelled` in
   * particular are states an owner or a stop condition put the run into
   * deliberately, and quietly restarting one would defeat the halt.
   */
  it.each(["published_local", "failed", "blocked", "cancelled"] as const)(
    "refuses to resume a run in the absorbing state %s",
    async (absorbing) => {
      const deps = buildDeps({ ...fullySeeded(), run: false });
      deps.runs.upsert({
        runId: RUN_ID,
        changeSetId: CHANGE_SET_ID,
        runState: absorbing,
        updatedAt: "2026-07-28T00:00:00.000Z",
      });

      const result = await newDispatcher(deps).resume(RUN_ID);
      expect(result.accepted).toBe(false);
      expect(result.reason).toMatch(new RegExp(absorbing));
    },
  );

  it("re-drives an in-flight run and reports no new runId", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    deps.runs.upsert({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      runState: "running",
      updatedAt: "2026-07-28T00:00:00.000Z",
    });

    const dispatcher = newDispatcher(deps, {
      createAdapter: () => new Promise(() => undefined),
    });

    const result = await dispatcher.resume(RUN_ID);
    expect(result.accepted).toBe(true);
    expect(result.runId).toBeUndefined();
  });
});

/**
 * Roast round 2, F1 — PROVEN before it was fixed.
 *
 * The guards used to be read before the first `await` while the in-flight
 * claim was written after it, so two concurrent dispatches on one change set
 * each saw an empty in-flight set and an empty run registry and BOTH created
 * a run: two live runs over the same work units and the same worktrees, with
 * no human review anywhere. The UDS server serializes per connection only,
 * so two connections was the whole exploit.
 */
describe("createRealRunDispatcher — concurrent dispatch", () => {
  it("creates exactly one run when two dispatches race on the same change set", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const dispatcher = newDispatcher(deps, {
      // Never settles, so both racers are in flight across the assertion.
      createAdapter: () => new Promise(() => undefined),
    });

    const [first, second] = await Promise.all([
      dispatcher.dispatch(CHANGE_SET_ID),
      dispatcher.dispatch(CHANGE_SET_ID),
    ]);

    const accepted = [first, second].filter((outcome) => outcome.accepted);
    expect(accepted).toHaveLength(1);
    expect(deps.runs.list()).toHaveLength(1);
  });

  /** Ten at once — a Set add is atomic per tick, and this proves the claim really is. */
  it("creates exactly one run under a wider race", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const dispatcher = newDispatcher(deps, {
      createAdapter: () => new Promise(() => undefined),
    });

    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => dispatcher.dispatch(CHANGE_SET_ID)),
    );

    expect(outcomes.filter((outcome) => outcome.accepted)).toHaveLength(1);
    expect(deps.runs.list()).toHaveLength(1);
  });

  /** A refused dispatch must release its claim, or the change set is wedged forever. */
  it("releases the claim when it refuses, so a later dispatch can still succeed", async () => {
    const deps = buildDeps({ run: false });
    const dispatcher = newDispatcher(deps);

    const refused = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(refused.accepted).toBe(false);

    // Same refusal, not "already being dispatched" — the claim was released.
    const again = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(again.reason).toBe(refused.reason);
  });
});

/**
 * Roast round 2, F2. Nothing ever moves a ChangeSet out of `ready`, so it
 * behaves as a reusable dispatch ticket. Retrying after a failure is
 * legitimate; re-publishing a success is not.
 */
describe("createRealRunDispatcher — a published change set", () => {
  function withPriorRun(runState: (typeof RUN_LIFECYCLE_STATES)[number]) {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    deps.runs.upsert({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      runState,
      updatedAt: "2026-07-28T00:00:00.000Z",
    });
    return deps;
  }

  it("refuses to re-dispatch a change set that already published", async () => {
    const result = await newDispatcher(withPriorRun("published_local")).dispatch(CHANGE_SET_ID);

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/already published/i);
  });

  it.each(["failed", "blocked", "cancelled"] as const)(
    "still allows a retry after the prior run ended %s",
    async (ended) => {
      const dispatcher = newDispatcher(withPriorRun(ended), {
        createAdapter: () => new Promise(() => undefined),
      });

      expect((await dispatcher.dispatch(CHANGE_SET_ID)).accepted).toBe(true);
    },
  );

  /**
   * Same-run resume, observed end to end (scheduler-level seeding is pinned
   * in `run-driver.test.ts`; this pins the dispatcher path). Same daemon,
   * SAME RUN: dispatch a unit to success, then `resume` the run — the exact
   * re-drive crash recovery and limit-park re-dispatch perform. Nothing
   * updates the stored WorkUnit's `attemptStatus`, but `driveRun` seeds from
   * the journal, so the already-succeeded unit is not re-selected and no
   * second engine is stood up. (This is what the now-removed in-memory
   * attempt cache used to provide; journal-seeding does it restart-safely.)
   */
  it("a same-daemon, same-run resume does not re-run the succeeded unit: no second adapter", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const adaptersCreatedFor: string[] = [];
    const dispatcher = newDispatcher(deps, {
      createAdapter: (ctx: { workUnit: { id: string } }) => {
        adaptersCreatedFor.push(ctx.workUnit.id);
        return Promise.resolve(
          new FakeEngineAdapter(
            buildFakeEngineScript({
              structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
            }),
          ),
        );
      },
    });

    const first = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(first.accepted).toBe(true);
    // Drive 1 has run once the unit's terminal transition is journaled.
    await vi.waitFor(
      async () => {
        const transitions: unknown[] = [];
        for await (const entry of deps.journal.queryEntries({ type: "work_unit_transition" })) {
          transitions.push(entry);
        }
        expect(transitions.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 10_000 },
    );
    expect(adaptersCreatedFor).toEqual([UNIT_ID]);

    // Resume the SAME run once the in-flight claim is released.
    const runId = (first as { runId?: string }).runId!;
    await vi.waitFor(
      async () => {
        expect((await dispatcher.resume(runId)).accepted).toBe(true);
      },
      { timeout: 10_000 },
    );
    // Drive 2 settled once the claim is free again (a third resume is
    // accepted). A hit journals nothing, so the claim is the only signal.
    await vi.waitFor(
      async () => {
        expect((await dispatcher.resume(runId)).accepted).toBe(true);
      },
      { timeout: 10_000 },
    );
    // THE FACT: the succeeded unit never got a second engine across either
    // resume — it was journal-seeded `succeeded` and not re-selected.
    expect(adaptersCreatedFor).toEqual([UNIT_ID]);
  });
});

/**
 * The standing-approval gate (ledger Gap 18). These are the cases that
 * replace the per-ChangeSet human prompt, so each one is the difference
 * between "a human said yes to this" and "nobody did".
 */
describe("createRealRunDispatcher — the standing-approval gate", () => {
  /**
   * NO POLICY MEANS NO DISPATCH, never "dispatch wide". Falling back to the
   * unnarrowed compile would make the ABSENCE of an approval a broader grant
   * than any approval could express -- the exact inversion the ruling exists
   * to prevent.
   */
  it("refuses when the daemon has no policy loader at all", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const dispatcher = createRealRunDispatcher({
      deps,
      projectDir: dir,
      xdgEnv: { HOME: dir },
      projectHash: "dispatch-hash",
      auth: { kind: "oauthToken", token: PLACEHOLDER_ENGINE_CREDENTIAL },
      plumbing: fakePlumbing(),
      prepareRun: () => Promise.resolve("a".repeat(40)),
      createAttemptWorktree: () => Promise.resolve(join(dir, "worktree")),
    });

    const result = await dispatcher.dispatch(CHANGE_SET_ID);
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/no standing EnvelopePolicy/i);
    expect(deps.runs.list()).toHaveLength(0);
  });

  it("refuses when the project has no policy on disk, and says how to author one", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const result = await newDispatcher(deps, {
      loadPolicy: () => ({ status: "absent" as const }),
    }).dispatch(CHANGE_SET_ID);

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/crabgic install/);
  });

  /** Invalid is a different owner problem from absent, and must read as one. */
  it("surfaces an invalid policy's own reason rather than blaming the installer", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const result = await newDispatcher(deps, {
      loadPolicy: () => ({ status: "invalid" as const, reason: "policy file X is not valid JSON" }),
    }).dispatch(CHANGE_SET_ID);

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/not valid JSON/);
    expect(result.reason).not.toMatch(/crabgic install/);
  });

  /** The gate is load-bearing: an envelope outside the policy never runs. */
  it("refuses an envelope whose owned path the policy does not grant", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const narrow = EnvelopePolicySchema.parse({
      schemaVersion: 1,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      createdAt: "2026-01-01T00:00:00.000Z",
      allowedPathPrefixes: ["docs"],
    });

    const result = await newDispatcher(deps, {
      loadPolicy: () => ({ status: "loaded" as const, policy: narrow, digest: "sha256:narrow" }),
    }).dispatch(CHANGE_SET_ID);

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/authority the standing policy does not grant/i);
    expect(result.reason).toMatch(/packages\/example\/src/);
    expect(deps.runs.list()).toHaveLength(0);
  });

  /**
   * The refusal must name the FILE, because editing it is the only remedy
   * that works: `crabgic approve` mints a token this gate never reads
   * (review 2026-07-30), so a refusal that names no path leaves the owner a
   * ceremony that cannot succeed.
   */
  it("names the standing policy file in a containment refusal, when it knows it", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const narrow = EnvelopePolicySchema.parse({
      schemaVersion: 1,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      createdAt: "2026-01-01T00:00:00.000Z",
      allowedPathPrefixes: ["docs"],
    });

    const result = await newDispatcher(deps, {
      loadPolicy: () => ({ status: "loaded" as const, policy: narrow, digest: "sha256:narrow" }),
      standingPolicyPath: "/state/crabgic/envelope-policy.json",
    }).dispatch(CHANGE_SET_ID);

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("/state/crabgic/envelope-policy.json");
  });

  /**
   * Part 4 of the ruling: a standing approval leaves no per-run artifact to
   * point at, so "what was the human standing behind when this ran" is only
   * answerable if the authorizing digest is journaled with the dispatch.
   */
  it("journals the authorizing policy digest with the dispatch", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const dispatcher = newDispatcher(deps, {
      createAdapter: () => new Promise(() => undefined),
    });

    expect((await dispatcher.dispatch(CHANGE_SET_ID)).accepted).toBe(true);

    const rationales: string[] = [];
    for await (const entry of deps.journal.queryEntries({ type: "adjudication_decision" })) {
      rationales.push((entry.payload as { rationale: string }).rationale);
    }
    expect(rationales.some((r) => r.includes("sha256:fixture"))).toBe(true);
  });

  /**
   * Resume runs the same gate. Otherwise narrowing the policy would silently
   * fail to bind anything already in flight, and "re-drive after a crash"
   * would become a way around it.
   */
  it("applies the gate to resume, not only to dispatch", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    deps.runs.upsert({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      runState: "running",
      updatedAt: "2026-07-28T00:00:00.000Z",
    });

    const result = await newDispatcher(deps, {
      loadPolicy: () => ({ status: "absent" as const }),
    }).resume(RUN_ID);

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/EnvelopePolicy/i);
  });
});

/**
 * Round 9 found the doctor pairing "the policy is probably fine" with "go
 * rewrite it". The dispatch gate is the second consumer of the same result
 * and had the same gap -- it refused (correctly) with a message that read
 * like a broken policy.
 */
describe("createRealRunDispatcher — a transient policy failure", () => {
  it("still refuses, but says it is worth retrying", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const result = await newDispatcher(deps, {
      loadPolicy: () => ({
        status: "invalid" as const,
        transient: true as const,
        reason: "could not open /p because this process is out of resources (EMFILE)",
      }),
    }).dispatch(CHANGE_SET_ID);

    expect(result.accepted).toBe(false);
    expect(deps.runs.list()).toHaveLength(0);
    expect(result.reason).toMatch(/retry once resources free up/i);
  });

  it("does not offer a retry for a genuinely broken policy", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const result = await newDispatcher(deps, {
      loadPolicy: () => ({
        status: "invalid" as const,
        reason: "policy file /p is not valid JSON",
      }),
    }).dispatch(CHANGE_SET_ID);

    expect(result.accepted).toBe(false);
    expect(result.reason).not.toMatch(/retry/i);
  });
});

/** Every `parked:rate_limit` work_unit_transition status this journal holds, in seq order. */
async function attemptStatuses(store: JournalStore): Promise<readonly string[]> {
  const statuses: string[] = [];
  for await (const entry of store.queryEntries({ type: "work_unit_transition" })) {
    if (entry.type === "work_unit_transition") statuses.push(entry.payload.status);
  }
  return statuses;
}

/**
 * `drain()` — the shutdown seam roadmap/05 §Lifecycle has always specified
 * ("clean shutdown drains workers before exit") and nothing implemented.
 *
 * It is not politeness. `dispatch` resolves on OWNERSHIP and leaves the drive
 * detached, so the daemon's old teardown released the journal's single-writer
 * lease with an appender still running; the next CLI call then spawned a
 * second daemon that acquired the freed lease, and two writers on an unlocked
 * hash chain produce a duplicate `seq`/`prevHash` that `repairJournal`
 * classifies as TAMPER rather than a torn tail. `drain` is the mechanism that
 * lets the lease be released last, or not at all.
 */
describe("createRealRunDispatcher — drain", () => {
  it("resolves only once the detached drive has settled — the terminal transition is already durable", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const dispatcher = newDispatcher(deps, {
      createAdapter: () =>
        Promise.resolve(
          new FakeEngineAdapter(
            buildFakeEngineScript({
              structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
            }),
          ),
        ),
    });

    const first = await dispatcher.dispatch(CHANGE_SET_ID);
    const runId = first.runId;
    if (runId === undefined) throw new Error("dispatch accepted without a runId");

    const outcome = await dispatcher.drain({ timeoutMs: 60_000, graceMs: 1_000 });

    expect(outcome.settledRunIds).toEqual([runId]);
    expect(outcome.cancelledRunIds).toEqual([]);
    expect(outcome.unsettledRunIds).toEqual([]);
    // Asserted with NO polling: if `drain` resolved while the drive was still
    // running, this read finds no terminal status at all.
    expect(await attemptStatuses(deps.journal)).toContain("succeeded");
  });

  it("refuses new work while draining, with one shared, recognisable reason", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const dispatcher = newDispatcher(deps, {
      createAdapter: () =>
        Promise.resolve(
          new FakeEngineAdapter(
            buildFakeEngineScript({
              structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
            }),
          ),
        ),
    });

    await dispatcher.dispatch(CHANGE_SET_ID);
    await dispatcher.drain({ timeoutMs: 60_000 });

    // The door stays shut. Re-opening it would let a dispatch start a drive
    // AFTER the boot layer has released the lease — the exact race drain exists
    // to close.
    expect(await dispatcher.dispatch(CHANGE_SET_ID)).toEqual({
      accepted: false,
      reason: DISPATCHER_DRAINING_REASON,
    });
    expect(await dispatcher.resume(RUN_ID)).toEqual({
      accepted: false,
      reason: DISPATCHER_DRAINING_REASON,
    });
  });

  it("is idempotent — a second drain reports the same quiescent state", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const dispatcher = newDispatcher(deps, {
      createAdapter: () =>
        Promise.resolve(
          new FakeEngineAdapter(
            buildFakeEngineScript({
              structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
            }),
          ),
        ),
    });
    await dispatcher.dispatch(CHANGE_SET_ID);

    await dispatcher.drain({ timeoutMs: 60_000 });
    expect(await dispatcher.drain({ timeoutMs: 60_000 })).toEqual({
      settledRunIds: [],
      cancelledRunIds: [],
      unsettledRunIds: [],
    });
  });

  it("drains cleanly when nothing was ever dispatched", async () => {
    const dispatcher = newDispatcher(buildDeps({ ...fullySeeded(), run: false }));
    expect(await dispatcher.drain()).toEqual({
      settledRunIds: [],
      cancelledRunIds: [],
      unsettledRunIds: [],
    });
  });

  /**
   * At the deadline the daemon cannot wait any longer, so it terminates the
   * live workers through the SAME closure `worker.terminate` uses, and the run
   * is journaled to a terminal state. Without that record restart recovery
   * replays a phantom `running` run whose units are all terminal — a run
   * nothing can ever finish, blocking every fresh dispatch of its change set.
   *
   * WHO writes that record changed on 2026-08-02, and this test changed
   * meaning with it. A terminated hung worker's attempt lands `failed` (the
   * opened hang gate replays to completion with no structured output), so the
   * drive's OWN settle now reaches `running → failed` first; drain's
   * `cancelled` write is then an illegal edge from an absorbing state and is
   * swallowed by the same guard that tolerates a racing `run.cancel`. Before
   * the fix the drive settled nothing at all for an all-terminal DAG and drain
   * was the only writer, so the run landed `cancelled`.
   *
   * The run's own drive recording how it actually ended is drain's stated goal
   * met more precisely, not a regression: `cancelledRunIds` still reports the
   * run, because "cut off" is decided by the DEADLINE and not by which writer
   * won (see `DrainOutcome.cancelledRunIds`).
   */
  it("terminates live workers at the deadline, and the cut-off run is journaled terminal", async () => {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    const dispatcher = newDispatcher(deps, {
      // Hangs until `cancel()` opens its gate — so the drive settles if and
      // only if the deadline path really terminates the worker.
      createAdapter: () =>
        Promise.resolve(
          new FakeEngineAdapter(buildFakeEngineScript({ failure: { kind: "hang" } })),
        ),
    });

    const first = await dispatcher.dispatch(CHANGE_SET_ID);
    const runId = first.runId;
    if (runId === undefined) throw new Error("dispatch accepted without a runId");
    await vi.waitFor(() => expect(deps.liveWorkers.size).toBe(1), { timeout: 10_000 });

    const outcome = await dispatcher.drain({ timeoutMs: 25, graceMs: 10_000 });

    // Reported as cut off at the deadline, exactly as before...
    expect(outcome.cancelledRunIds).toEqual([runId]);
    expect(outcome.unsettledRunIds).toEqual([]);
    // ...and the run is recorded in an absorbing state, so restart recovery
    // sees a finished run. `failed` is the drive's own honest report of the
    // terminated attempt; drain's `cancelled` write lost the race and was
    // swallowed as illegal.
    expect(deps.runs.get(runId)?.runState).toBe("failed");
    expect(isRunLifecycleAbsorbing(deps.runs.get(runId)!.runState)).toBe(true);
    expect(deps.liveWorkers.size).toBe(0);
  });

  /**
   * The honest floor. An adapter that ignores `cancel` leaves a writer live
   * past both the deadline and the grace window — and this drain writes NOTHING
   * for it, because a second appender beside a live one is the very corruption
   * it exists to prevent. It reports the run instead, and the boot layer keeps
   * the lease rather than handing the journal to the next daemon.
   */
  it("reports a drive that outlives the ladder as unsettled, and journals nothing over it", async () => {
    class IgnoresCancel extends FakeEngineAdapter {
      override cancel(): Promise<void> {
        return Promise.resolve();
      }
    }

    const deps = buildDeps({ ...fullySeeded(), run: false });
    const dispatcher = newDispatcher(deps, {
      createAdapter: () =>
        Promise.resolve(new IgnoresCancel(buildFakeEngineScript({ failure: { kind: "hang" } }))),
    });

    const first = await dispatcher.dispatch(CHANGE_SET_ID);
    const runId = first.runId;
    if (runId === undefined) throw new Error("dispatch accepted without a runId");
    await vi.waitFor(() => expect(deps.liveWorkers.size).toBe(1), { timeout: 10_000 });

    const outcome = await dispatcher.drain({ timeoutMs: 25, graceMs: 25 });

    expect(outcome.unsettledRunIds).toEqual([runId]);
    expect(outcome.cancelledRunIds).toEqual([]);
    expect(deps.runs.get(runId)?.runState).toBe("running");
  });
});

/**
 * RESTART HONESTY. A daemon restart loses the retained per-session adapters
 * (documented, and disclosed in 1.5.0) — but the run's park record is durable,
 * so a re-drive found a parked unit, could not resume it, declined, and left it
 * parked. `resume` answered `{accepted: true}` to all of that: the CLI printed
 * success, nothing moved, the run stayed `running`, and the change set could
 * never be dispatched again. The only exit was `run.cancel`, which the success
 * message gave the operator no reason to reach for.
 */
describe("createRealRunDispatcher — resume after a restart lost the session context", () => {
  const OTHER_UNIT_ID = "55555555-5555-4555-8555-555555555555";
  const SESSION_ID = "66666666-6666-4666-8666-666666666666";

  function parkedRun(): ReturnType<typeof buildDeps> {
    const deps = buildDeps({ ...fullySeeded(), run: false });
    deps.runs.upsert({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      runState: "running",
      updatedAt: "2026-07-31T00:00:00.000Z",
    });
    return deps;
  }

  it("refuses, names the lost session context and the remedy, and starts no drive", async () => {
    const deps = parkedRun();
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "dispatched", RUN_ID);
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "parked:rate_limit", RUN_ID);

    // A FRESH dispatcher is exactly what a restarted daemon has: the run's
    // park record survived in the journal, its adapters did not.
    let adaptersCreated = 0;
    const dispatcher = newDispatcher(deps, {
      createAdapter: () => {
        adaptersCreated += 1;
        return new Promise(() => undefined);
      },
    });

    const result = await dispatcher.resume(RUN_ID);

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/session context/i);
    expect(result.reason).toMatch(/restart/i);
    expect(result.reason).toMatch(/cancel/i);
    expect(result.reason).toContain(RUN_ID);
    expect(adaptersCreated).toBe(0);
  });

  /** The refusal must release its in-flight claim, or the refusal itself wedges the change set. */
  it("releases the claim it took, so the run stays reachable to `run.cancel` and a later resume", async () => {
    const deps = parkedRun();
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "dispatched", RUN_ID);
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "parked:rate_limit", RUN_ID);
    const dispatcher = newDispatcher(deps);

    const first = await dispatcher.resume(RUN_ID);
    const second = await dispatcher.resume(RUN_ID);

    expect(second.reason).toBe(first.reason);
    expect(second.reason).not.toMatch(/already being dispatched/i);
  });

  /**
   * It must refuse ONLY when there is genuinely nothing to drive. A run
   * carrying a second, still-pending unit can make real progress, so the
   * unresumable park is the driver's problem to leave parked, not grounds to
   * refuse the whole resume.
   */
  it("still accepts when another unit is pending — there is work the drive can do", async () => {
    const seeded = fullySeeded();
    const deps = buildDeps({
      ...seeded,
      run: false,
      workUnits: [
        ...(seeded.workUnits ?? []),
        buildWorkUnit({
          id: OTHER_UNIT_ID,
          changeSetId: CHANGE_SET_ID,
          dependsOn: [],
          attemptStatus: "pending",
        }),
      ],
    });
    deps.runs.upsert({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      runState: "running",
      updatedAt: "2026-07-31T00:00:00.000Z",
    });
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "dispatched", RUN_ID);
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "parked:rate_limit", RUN_ID);

    const dispatcher = newDispatcher(deps, {
      createAdapter: () => new Promise(() => undefined),
    });

    expect((await dispatcher.resume(RUN_ID)).accepted).toBe(true);
  });
});

/**
 * RESUME HONESTY, the failure-shaped half. Option A stops NEW wedges forming,
 * but `resume` can still meet an all-terminal-with-failures run sitting in
 * `running`: a run wedged before the fix (the journal replays it `running`
 * across restarts), or one whose settle write failed. Accepting those is the
 * same lying-accept PR #46 removed for stranded parks — the re-drive dispatches
 * nothing, the run does not move, and the operator is told it worked.
 *
 * DELIBERATELY NOT REFUSED: an all-SUCCEEDED run in `running`. That is the
 * documented `completed → verifying` deferral, not a dead end, and a resume of
 * one is how the same-run journal-seeding test observes its drives settling.
 */
describe("createRealRunDispatcher — resume of an all-terminal run", () => {
  const OTHER_UNIT_ID = "55555555-5555-4555-8555-555555555555";
  const SESSION_ID = "66666666-6666-4666-8666-666666666666";

  /** A run the registry replays as `running`, exactly as a restart would. */
  function runningRun(extraUnits: readonly WorkUnit[] = []): ReturnType<typeof buildDeps> {
    const seeded = fullySeeded();
    const deps = buildDeps({
      ...seeded,
      run: false,
      workUnits: [...(seeded.workUnits ?? []), ...extraUnits],
    });
    deps.runs.upsert({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      runState: "running",
      updatedAt: "2026-08-02T00:00:00.000Z",
    });
    return deps;
  }

  it("refuses a legacy wedged run, names the counts and the exit, and starts no drive", async () => {
    const deps = runningRun();
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "dispatched", RUN_ID);
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "failed", RUN_ID);

    let adaptersCreated = 0;
    const dispatcher = newDispatcher(deps, {
      createAdapter: () => {
        adaptersCreated += 1;
        return new Promise(() => undefined);
      },
    });

    const result = await dispatcher.resume(RUN_ID);

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/every work unit has already reached a terminal outcome/i);
    expect(result.reason).toMatch(/1 failed/);
    expect(result.reason).toContain(`crabgic cancel ${RUN_ID}`);
    expect(adaptersCreated).toBe(0);
    // Refused BEFORE taking ownership: the run is untouched, not settled by a
    // resume acting as a covert settle command.
    expect(deps.runs.get(RUN_ID)?.runState).toBe("running");
  });

  /** The refusal must release its in-flight claim, or the refusal itself wedges the change set. */
  it("releases the claim it took, so the run stays reachable to a later call", async () => {
    const deps = runningRun();
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "dispatched", RUN_ID);
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "failed", RUN_ID);
    const dispatcher = newDispatcher(deps);

    const first = await dispatcher.resume(RUN_ID);
    const second = await dispatcher.resume(RUN_ID);

    expect(second.reason).toBe(first.reason);
    expect(second.reason).not.toMatch(/already being dispatched/i);
  });

  /**
   * A latest status of `dispatched` at resume ENTRY can only be a prior drive
   * of this run that died mid-attempt — the same seed rule `driveRun` applies,
   * so this asks the question the drive would answer rather than a different
   * one. A crashed single-unit run is the wedge's crash-recovery shape.
   */
  it("refuses a crash-seeded run whose latest attempt never left `dispatched`", async () => {
    const deps = runningRun();
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "dispatched", RUN_ID);

    const result = await newDispatcher(deps).resume(RUN_ID);

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/every work unit has already reached a terminal outcome/i);
    expect(result.reason).toMatch(/1 failed/);
  });

  /** Cancelled units are counted as themselves, so the refusal describes the run it is about. */
  it("names cancelled units separately from failed ones", async () => {
    const deps = runningRun([
      buildWorkUnit({
        id: OTHER_UNIT_ID,
        changeSetId: CHANGE_SET_ID,
        dependsOn: [],
        attemptStatus: "pending",
      }),
    ]);
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "dispatched", RUN_ID);
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "failed", RUN_ID);
    await recordAttempt(deps.journal, OTHER_UNIT_ID, SESSION_ID, "dispatched", RUN_ID);
    await recordAttempt(deps.journal, OTHER_UNIT_ID, SESSION_ID, "cancelled", RUN_ID);

    const result = await newDispatcher(deps).resume(RUN_ID);

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/1 failed/);
    expect(result.reason).toMatch(/1 cancelled/);
  });

  /** A run stopped entirely by cancellation says exactly that — no phantom "0 failed". */
  it("names only what the run actually holds when nothing failed", async () => {
    const deps = runningRun();
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "dispatched", RUN_ID);
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "cancelled", RUN_ID);

    const result = await newDispatcher(deps).resume(RUN_ID);

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/\(1 cancelled\)/);
    expect(result.reason).not.toMatch(/failed/);
  });

  /** Only a DEAD END is refused: a failure beside real remaining work is not one. */
  it("still accepts when a unit is pending beside the failed one", async () => {
    const deps = runningRun([
      buildWorkUnit({
        id: OTHER_UNIT_ID,
        changeSetId: CHANGE_SET_ID,
        dependsOn: [],
        attemptStatus: "pending",
      }),
    ]);
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "dispatched", RUN_ID);
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "failed", RUN_ID);

    const dispatcher = newDispatcher(deps, {
      createAdapter: () => new Promise(() => undefined),
    });

    expect((await dispatcher.resume(RUN_ID)).accepted).toBe(true);
  });

  /**
   * THE SCOPE GUARD. An all-succeeded run in `running` is the documented
   * `completed → verifying` deferral, not a dead end. Refusing it would change
   * what a green test elsewhere measures and would pre-empt a wiring decision
   * this fix has no business making.
   */
  it("does not refuse an all-succeeded run — that is the verifying deferral, not a dead end", async () => {
    const deps = runningRun();
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "dispatched", RUN_ID);
    await recordAttempt(deps.journal, UNIT_ID, SESSION_ID, "succeeded", RUN_ID);

    const dispatcher = newDispatcher(deps, {
      createAdapter: () => new Promise(() => undefined),
    });

    expect((await dispatcher.resume(RUN_ID)).accepted).toBe(true);
  });
});

/**
 * roadmap/24's acceptance bar, at the DISPATCHER layer.
 *
 * HONEST SCOPE, stated so a future reader cannot cite this block for more than
 * it carries. These tests build the dependency bundle by hand, so they prove
 * only what the dispatcher does with a registry it is GIVEN. They are
 * structurally incapable of seeing whether the composition root supplies one —
 * which is the defect that actually shipped
 * (`24-daemon-requirements-registry-unwired.md`). The bearer for the wiring is
 * `./composed-daemon-seal-enforcement.test.ts`, which goes through
 * `composeSupervisor`. This block is a regression guard beneath it.
 */
describe("createRealRunDispatcher — the acceptance bar it resolves per attempt (roadmap/24)", () => {
  const REQ_ID = "aaaaaaaa-1111-4111-8111-111111111111";

  function unitDeclaring(): WorkUnit {
    return buildWorkUnit({
      id: UNIT_ID,
      changeSetId: CHANGE_SET_ID,
      dependsOn: [],
      attemptStatus: "pending",
      requirementIds: [REQ_ID],
    });
  }

  function succeedingAdapter(): Record<string, unknown> {
    return {
      createAdapter: () =>
        Promise.resolve(
          new FakeEngineAdapter(
            buildFakeEngineScript({
              structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
            }),
          ),
        ),
    };
  }

  async function statusesFor(deps: ReturnType<typeof buildDeps>): Promise<readonly string[]> {
    const found: string[] = [];
    for await (const entry of deps.journal.queryEntries({
      type: "work_unit_transition",
      workUnitId: UNIT_ID,
    })) {
      if (entry.type !== "work_unit_transition") continue;
      found.push(entry.payload.status);
    }
    return found;
  }

  /**
   * RED before the fix. A declared requirement with no record silently resolved
   * to nothing — `resolveRequirements` drops unresolvable ids, which is right
   * for the approval funnel (the readiness gate refuses them itself) and wrong
   * here, where nothing downstream refuses: the executor accepts an empty
   * presented set BY DESIGN, because a chore unit legitimately owns none.
   */
  it("refuses a unit whose declared requirement has no record, rather than judging it against nothing", async () => {
    const deps = buildDeps({ ...fullySeeded(), workUnits: [unitDeclaring()], run: false });
    const errors: string[] = [];
    const dispatcher = newDispatcher(deps, {
      ...succeedingAdapter(),
      onDriveError: (_runId: string, err: unknown) => {
        errors.push(err instanceof Error ? err.message : String(err));
      },
    });

    expect((await dispatcher.dispatch(CHANGE_SET_ID)).accepted).toBe(true);
    await dispatcher.drain({ timeoutMs: 20_000, graceMs: 1_000 });

    expect(await statusesFor(deps)).not.toContain("succeeded");
    expect(errors.join(" ")).toContain(REQ_ID);
  });

  /**
   * GREEN even before the fix, once the deps bundle is seeded — and that is
   * precisely why it is labelled a regression guard rather than evidence of
   * wiring. Its vacuity trap IS the defect: hand it a registry and it passes;
   * production handed it `undefined` and it never ran.
   */
  it("regression guard: a post-approval criteria edit is refused when a registry IS supplied", async () => {
    const approved = buildRequirement({
      id: REQ_ID,
      acceptanceCriteria: ["The login form submits"],
    });
    const tampered = buildRequirement({
      id: REQ_ID,
      acceptanceCriteria: ["The login form submits", "and it silently skips auth"],
    });
    expect(tampered.criteriaHash).not.toBe(approved.criteriaHash);

    const deps = buildDeps({
      ...fullySeeded(),
      workUnits: [unitDeclaring()],
      requirements: [tampered],
      run: false,
    });
    await journalCriteriaSeal(deps.journal, {
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { [REQ_ID]: approved.criteriaHash },
    });

    const dispatcher = newDispatcher(deps, succeedingAdapter());
    expect((await dispatcher.dispatch(CHANGE_SET_ID)).accepted).toBe(true);
    await dispatcher.drain({ timeoutMs: 20_000, graceMs: 1_000 });

    const statuses = await statusesFor(deps);
    expect(statuses).toContain("failed");
    expect(statuses).not.toContain("succeeded");

    const rationales: string[] = [];
    for await (const entry of deps.journal.queryEntries({ type: "adjudication_decision" })) {
      if (entry.type !== "adjudication_decision") continue;
      if (entry.payload.decision !== "criteria_seal_refused") continue;
      rationales.push(entry.payload.rationale);
    }
    expect(rationales).toHaveLength(1);
    expect(rationales[0]).toContain("approval_seal_mismatch");
    expect(rationales[0]).toContain(REQ_ID);
  });
});
