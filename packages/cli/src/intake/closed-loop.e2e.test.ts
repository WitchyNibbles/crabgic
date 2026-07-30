/**
 * The closed loop: intake -> approval -> dispatch -> a driven work unit.
 *
 * THIS IS THE TEST THE AUDIT SAID COULD NOT EXIST. On 2026-07-28 an audit of
 * the shipped `1.3.0` binary found the chain broken in the middle: intake
 * built a ChangeSet, approval flipped it to `ready`, and then nothing could
 * execute it — no production code ever created a `RunRecord`, so
 * `run.dispatch` answered "unknown run" for every id an operator could
 * supply and `status` printed `no runs` after a complete, successful
 * approval. Everything downstream was built, tested, and unreachable.
 *
 * So this exercises the JOIN, not the pieces: real intake, real approval-token
 * mint and verify, the real standing-policy gate, the real dispatcher and
 * `driveRun`. Only two things are substituted, and both for reasons that would
 * apply to any test: the engine is 03's fake (a real one would spend the
 * owner's subscription), and the git boundary is seamed so no repository is
 * cloned or frozen.
 *
 * Per roadmap/11's own exit criterion — "E2E (fake engine): request ->
 * contract -> approval -> run".
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { EnvelopePolicySchema, type EnvelopePolicy } from "@crabgic/contracts";
import {
  computeIntentContractId,
  computeRequirementId,
  createAuthorizationEnvelopesRegistry,
  createChangeSetsRegistry,
  createIntentContractsRegistry,
  createRunsRegistry,
  createWorkersRegistry,
  createArtifactIndexRegistry,
  createWorkUnitsRegistry,
  type IntakeRequest,
} from "@crabgic/supervisor";
import { FakeEngineAdapter, buildFakeEngineScript, buildWorkerResult } from "@crabgic/testkit";
import { ApprovalTokenMinter } from "../approval/token.js";
import { runIntakeCommand } from "./run-intake-command.js";
import { dispatchCommand } from "../commands/dispatch.js";
import { createRealRunDispatcher } from "../daemon/run-dispatcher.js";

const CHANGE_SET_ID = "11111111-1111-4111-8111-111111111111";
const PLACEHOLDER_CREDENTIAL = "not-a-real-token";

let dir: string;
let journal: JournalStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eo-closed-loop-"));
  journal = createJournalStore({ journalDir: join(dir, "journal") });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function intakeRequest(): IntakeRequest {
  return {
    requestKey: "closed-loop",
    id: CHANGE_SET_ID,
    createdAt: "2026-01-01T00:00:00.000Z",
    sections: {
      scope: "Add a login form.",
      "non-goals": "No SSO.",
      audience: "End users.",
      compatibility: "None broken.",
      security: "Rate-limited.",
      performance: "p95 < 200ms.",
      observability: "login_attempt metric.",
      rollout: "No flag.",
      acceptance: "Login succeeds.",
    },
    requirements: [
      {
        section: "scope",
        title: "Add login form",
        description: "d",
        acceptanceCriteria: ["works"],
      },
    ],
    // One real work unit, so there is something to dispatch. The pre-existing
    // intake e2e used an empty DAG because it stopped at `ready`; this one has
    // to get all the way to a driven attempt.
    workUnits: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        title: "Add the login form",
        // Mapped for real: in-process approval resolves requirement coverage
        // server-side from the ChangeSet's own contract, so an unmapped
        // requirement would (correctly) refuse the ready transition.
        requirementIds: [
          computeRequirementId(computeIntentContractId(CHANGE_SET_ID), {
            section: "scope",
            title: "Add login form",
          }),
        ],
        dependsOn: [],
        role: "implementation",
        ownedPaths: ["src/login"],
      },
    ],
    envelopeContent: {
      ownedPaths: ["src/login"],
      commands: [],
      networkDestinations: [],
      credentialReferences: [],
      dependencies: [],
      remoteResourceAuthorizations: [],
      temporaryServices: [],
      prohibitedActions: [],
    },
    rollbackStrategy: "Revert the integration commit.",
    performanceBudgetSource: "requirement_acceptance_criteria",
    performanceBudgets: [{ metric: "latency", percentile: 95, threshold: 200, unit: "ms" }],
    capabilityManifest: {
      engineEntry: {
        kind: "engine",
        engineVersion: "2.1.0-fake",
        supportsJsonSchema: true,
        supportsSessionResume: true,
      },
    },
  };
}

function policy(overrides: Partial<EnvelopePolicy> = {}): EnvelopePolicy {
  return EnvelopePolicySchema.parse({
    schemaVersion: 1,
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    createdAt: "2026-01-01T00:00:00.000Z",
    allowedPathPrefixes: ["src"],
    ...overrides,
  });
}

/** Runs intake and approval for real, and returns everything dispatch needs. */
async function intakeAndApprove() {
  const changeSets = createChangeSetsRegistry();
  const workUnits = createWorkUnitsRegistry();
  const envelopes = createAuthorizationEnvelopesRegistry();
  const intentContracts = createIntentContractsRegistry();

  const commandPromise = runIntakeCommand({
    journal,
    changeSets,
    workUnits,
    envelopes,
    intentContracts,
    readIntakeRequest: () => Promise.resolve(intakeRequest()),
    loadPolicy: () => ({ status: "loaded", policy: policy(), digest: "sha256:e2e" }),
  });
  const outcome = await commandPromise;
  if (outcome.outcome.status === "conflict") throw new Error("unreachable");
  // The standing policy decides; nobody is prompted, nothing is minted.
  expect(outcome.standing?.status).toBe("approved");
  expect(changeSets.get(CHANGE_SET_ID)?.state).toBe("ready");

  return { changeSets, workUnits, envelopes };
}

function buildDispatcher(
  registries: Awaited<ReturnType<typeof intakeAndApprove>>,
  loadedPolicy: EnvelopePolicy,
) {
  const runs = createRunsRegistry();
  const deps = {
    journal,
    runs,
    changeSets: registries.changeSets,
    workUnits: registries.workUnits,
    envelopes: registries.envelopes,
    workers: createWorkersRegistry(),
    artifactIndex: createArtifactIndexRegistry(),
    liveWorkers: new Map(),
  };

  const dispatcher = createRealRunDispatcher({
    deps: deps as never,
    projectDir: dir,
    xdgEnv: { HOME: dir },
    projectHash: "closed-loop",
    auth: { kind: "oauthToken", token: PLACEHOLDER_CREDENTIAL },
    loadPolicy: () => ({ status: "loaded", policy: loadedPolicy, digest: "sha256:e2e" }),
    // Git boundary seams: no clone, no freeze, no `worktree add`.
    prepareRun: () => Promise.resolve("a".repeat(40)),
    createAttemptWorktree: () => Promise.resolve(join(dir, "worktree")),
    createAdapter: () =>
      Promise.resolve(
        new FakeEngineAdapter(
          buildFakeEngineScript({ structuredOutput: buildWorkerResult({ outcome: "succeeded" }) }),
        ),
      ),
  });

  return { dispatcher, runs };
}

/**
 * THE WHOLE CHAIN, entered where a user actually enters it.
 *
 * Every other test in this file calls `dispatcher.dispatch(...)` directly,
 * which is what let the chain look healthy while being unreachable: from
 * 1.0.0 through 1.4.0 the ONLY caller of `run.dispatch` in the repository was
 * a test exactly like that one. This test starts at `dispatchCommand`, the
 * function `bin.ts` calls, and replaces the router hop with a direct call into
 * the same real dispatcher the daemon builds.
 *
 * WHAT IS STILL FAKED, stated precisely because the first version of this
 * comment claimed "nothing but the socket transport" and that was not true:
 * the engine adapter, the attempt worktree, and the git freeze are all seams
 * here. What this case genuinely proves is the CHAIN —
 * `dispatchCommand` → `run.dispatch` → the real `createRealRunDispatcher` with
 * its own policy gate → `createRun` → `driveRun` → `spawn` — which is the part
 * that had no shipped caller at all. It does NOT prove a worker did useful
 * work: `work_unit_transition("dispatched")` is written immediately after
 * `adapter.spawn(...)`, before any engine event is read.
 */
describe("closed loop — entered through the shipped `run` command", () => {
  it("takes an intake request all the way to a driven run with no human asked", async () => {
    const secretKey = randomBytes(32);
    const changeSets = createChangeSetsRegistry();
    const workUnits = createWorkUnitsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const intentContracts = createIntentContractsRegistry();
    const runs = createRunsRegistry();
    const standingPolicy = policy();

    const dispatcher = createRealRunDispatcher({
      deps: {
        journal,
        runs,
        changeSets,
        workUnits,
        envelopes,
        workers: createWorkersRegistry(),
        artifactIndex: createArtifactIndexRegistry(),
        liveWorkers: new Map(),
      } as never,
      projectDir: dir,
      xdgEnv: { HOME: dir },
      projectHash: "closed-loop-cli",
      auth: { kind: "oauthToken", token: PLACEHOLDER_CREDENTIAL },
      loadPolicy: () => ({ status: "loaded", policy: standingPolicy, digest: "sha256:e2e" }),
      prepareRun: () => Promise.resolve("a".repeat(40)),
      createAttemptWorktree: () => Promise.resolve(join(dir, "worktree")),
      createAdapter: () =>
        Promise.resolve(
          new FakeEngineAdapter(
            buildFakeEngineScript({
              structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
            }),
          ),
        ),
    });

    // The ONLY fake: the UDS hop. `run.dispatch` lands on the same real
    // dispatcher `bin/supervisord.ts` injects into the router.
    const output = new PassThrough();
    let prompted = false;
    output.on("data", () => {
      prompted = true;
    });
    const deps = {
      connectClient: () =>
        Promise.resolve({
          request: (op: string, params: Record<string, unknown>) =>
            op === "run.dispatch"
              ? dispatcher.dispatch(params.changeSetId as string)
              : Promise.reject(new Error(`unexpected op ${op}`)),
          close: () => Promise.resolve(),
        } as never),
      journal,
      projectHash: "closed-loop-cli",
      intake: {
        journal,
        changeSets,
        workUnits,
        envelopes,
        intentContracts,
        minter: new ApprovalTokenMinter({ secretKey }),
        secretKey,
        readIntakeRequest: () => Promise.resolve(intakeRequest()),
        io: { input: new PassThrough(), output },
        loadPolicy: () => ({
          status: "loaded" as const,
          policy: standingPolicy,
          digest: "sha256:e2e",
        }),
      },
    };

    // No keystroke is ever written: an in-policy request must need none.
    const result = await dispatchCommand({ command: "run", json: true }, deps as never);

    expect(result.exitCode).toBe(0);
    expect(prompted).toBe(false);
    const parsed = JSON.parse(result.stdout!) as {
      standing: { status: string; policyDigest?: string };
      dispatch: { accepted: boolean; runId?: string };
    };
    expect(parsed.standing.status).toBe("approved");
    expect(parsed.standing.policyDigest).toBe("sha256:e2e");
    expect(parsed.dispatch.accepted).toBe(true);
    expect(parsed.dispatch.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(parsed)).not.toContain('"token"');

    // A real run exists, and real work actually ran under it.
    expect(runs.get(parsed.dispatch.runId!)?.runState).toBe("running");
    await vi.waitFor(
      async () => {
        const transitions: unknown[] = [];
        for await (const entry of journal.queryEntries({ type: "work_unit_transition" })) {
          transitions.push(entry);
        }
        expect(transitions.length).toBeGreaterThan(0);
      },
      { timeout: 10_000 },
    );
  });
});

describe("closed loop — request -> contract -> approval -> a driven run", () => {
  it("drives an approved change set through to a journaled work-unit transition", async () => {
    const registries = await intakeAndApprove();
    const { dispatcher, runs } = buildDispatcher(registries, policy());

    const outcome = await dispatcher.dispatch(CHANGE_SET_ID);

    // Dispatch MINTS the run id -- the thing no caller could previously obtain.
    expect(outcome.accepted).toBe(true);
    expect(outcome.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(runs.get(outcome.runId!)?.runState).toBe("running");

    await vi.waitFor(
      async () => {
        const transitions: unknown[] = [];
        for await (const entry of journal.queryEntries({ type: "work_unit_transition" })) {
          transitions.push(entry);
        }
        expect(transitions.length).toBeGreaterThan(0);
      },
      { timeout: 10_000 },
    );
  });

  /**
   * The standing approval is load-bearing in the whole chain, not just in a
   * unit test: an approved, `ready` ChangeSet whose authority the policy does
   * not grant still does not run, and no run is created to strand it.
   */
  it("refuses the same approved change set when the policy does not grant its paths", async () => {
    const registries = await intakeAndApprove();
    const { dispatcher, runs } = buildDispatcher(
      registries,
      policy({ allowedPathPrefixes: ["docs"] }),
    );

    const outcome = await dispatcher.dispatch(CHANGE_SET_ID);

    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toMatch(/standing policy does not grant/i);
    expect(runs.list()).toHaveLength(0);
  });

  /** And with no policy at all, the loop stays closed rather than falling open. */
  it("refuses when the project has no standing policy", async () => {
    const registries = await intakeAndApprove();
    const runs = createRunsRegistry();
    const dispatcher = createRealRunDispatcher({
      deps: {
        journal,
        runs,
        changeSets: registries.changeSets,
        workUnits: registries.workUnits,
        envelopes: registries.envelopes,
        workers: createWorkersRegistry(),
        artifactIndex: createArtifactIndexRegistry(),
        liveWorkers: new Map(),
      } as never,
      projectDir: dir,
      xdgEnv: { HOME: dir },
      projectHash: "closed-loop",
      auth: { kind: "oauthToken", token: PLACEHOLDER_CREDENTIAL },
      loadPolicy: () => ({ status: "absent" }),
      prepareRun: () => Promise.resolve("a".repeat(40)),
      createAttemptWorktree: () => Promise.resolve(join(dir, "worktree")),
    });

    const outcome = await dispatcher.dispatch(CHANGE_SET_ID);

    expect(outcome.accepted).toBe(false);
    expect(runs.list()).toHaveLength(0);
  });
});
