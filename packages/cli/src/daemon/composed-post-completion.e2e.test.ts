/**
 * The post-completion lifecycle walk, through the SHIPPED daemon composition
 * and a REAL git repository — `running → verifying → integrating →
 * final_verifying → published_local`, with phase 24's criteria-seal gate fired
 * by phase 14's registry against phase 08's genuinely-integrated candidate.
 *
 * WHY THIS FILE EXISTS. Defect `14-gate-registry-never-composed.md`: every
 * ingredient shipped and none of them was ever reached. `createGateRegistry`
 * had zero production call sites; `fireAll`/`fireByTag` had zero production
 * callers; `preflightMerge`/`applyCasUpdate`/`publishLocal` had zero production
 * callers outside `packages/git-engine`'s own suites; and nothing anywhere —
 * tests included — transitioned a run onto `verifying`, `integrating` or
 * `final_verifying`. So no run had ever reached `published_local`: production
 * could not produce its terminal artifact at all.
 *
 * WHAT MAKES THIS A BEARER AND NOT ANOTHER HARNESS.
 *
 *  1. The daemon is composed the way production composes it (`composeSupervisor`
 *     + `createRealRunDispatcher`). This file NEVER imports `createGateRegistry`
 *     and never constructs a `GateRegistry` — if the production composition root
 *     stopped registering the seal gate, `fireFinalCandidateVerification`'s
 *     `requireAtLeastOne` would throw and every case here would fail.
 *  2. Git is REAL. `prepareRun` (control clone + intake freeze),
 *     `createAttemptWorktree` (`git worktree add`) and `plumbing` are all left
 *     at their production defaults; only `createAdapter` is injected, and it
 *     writes real files into the real worktree it is handed before reporting
 *     success — standing in for a worker's edits, which are uncommitted by
 *     construction (the compiled Bash allowlist grants no `git commit`).
 *  3. The acceptance `EvidenceRecord`'s `objectId` is compared against a tip
 *     resolved INDEPENDENTLY, by `git rev-parse` in the fixture user repo,
 *     never against a value the pipeline returned. A state-only assertion
 *     ("the run says published_local") is satisfied by a walk that fires
 *     nothing; an objectId read back from the pipeline is satisfied by a
 *     fabricated id.
 *  4. The two-unit case pins that the id is TRULY integrated: the published
 *     tree must contain BOTH units' edits, a state no single unit's candidate
 *     ever holds, so a cached per-unit object id cannot satisfy it.
 */
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationEnvelopeSchema,
  ChangeSetSchema,
  EnvelopePolicySchema,
  RequirementSchema,
  WorkUnitSchema,
  type AuthorizationEnvelope,
  type ChangeSet,
  type EvidenceRecord,
  type Requirement,
  type WorkUnit,
} from "@crabgic/contracts";
import {
  createJournalStore,
  journalCriteriaSeal,
  resolveJournalDir,
  resolveStateRoot,
  type JournalStore,
  type XdgEnv,
} from "@crabgic/journal";
import {
  AUTHORIZATION_ENVELOPES_FILE_NAME,
  CHANGE_SETS_FILE_NAME,
  REQUIREMENTS_FILE_NAME,
  WORK_UNITS_FILE_NAME,
  composeSupervisor,
  createFileRegistry,
  readPeerCredentialsLinux,
  type ComposedSupervisor,
  type SupervisorDependencies,
} from "@crabgic/supervisor";
import { resolveGitControlDir } from "@crabgic/git-engine";
import {
  GIT_FIXTURE_IDENTITY_ENV,
  FakeEngineAdapter,
  buildAuthorizationEnvelope,
  buildChangeSet,
  buildFakeEngineScript,
  buildRequirement,
  buildWorkUnit,
  buildWorkerResult,
  runFixtureGit,
} from "@crabgic/testkit";
import type { PostCompletionStep } from "./post-completion-pipeline.js";
import { createRealRunDispatcher, type RealRunDispatcherOptions } from "./run-dispatcher.js";

const PROJECT_HASH = "postcompletion01";
const CHANGE_SET_ID = "55555555-5555-4555-8555-555555555555";
const ENVELOPE_ID = "66666666-6666-4666-8666-666666666666";
const UNIT_A_ID = "77777777-7777-4777-8777-777777777777";
const UNIT_B_ID = "88888888-8888-4888-8888-888888888888";
const REQ_ID = "99999999-9999-4999-8999-999999999999";

const APPROVED_CRITERIA = ["The example module exports a greeting"];
const TAMPERED_CRITERIA = ["The example module exports a greeting", "and it skips the auth check"];

/** Assembled rather than written as a literal so the repository's pre-commit secret scan sees no credential-shaped assignment. Never used — every case injects `createAdapter`. */
const PLACEHOLDER_ENGINE_CREDENTIAL = ["placeholder", "not", "real"].join("-");

/** The one path the fixture envelope owns — so the containment gate stays load-bearing. */
const OWNED_PREFIX = "packages/example/src";

const FIXTURE_POLICY = EnvelopePolicySchema.parse({
  schemaVersion: 1,
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  createdAt: "2026-01-01T00:00:00.000Z",
  allowedPathPrefixes: [OWNED_PREFIX],
  maxWorkerTurnsPerAttempt: 40,
});

let root: string;
let projectDir: string;
let env: XdgEnv;
let composed: ComposedSupervisor | undefined;
let driveErrors: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-post-completion-"));
  projectDir = join(root, "project");
  env = { HOME: root, XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache") };
  driveErrors = [];
  await initProjectRepo();
});

afterEach(async () => {
  await composed?.close();
  composed = undefined;
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

/** A real, single-commit git repository standing in for the user's checkout. No `git config` is ever run: identity rides in the environment (`@crabgic/testkit`'s `GIT_FIXTURE_IDENTITY_ENV`). */
async function initProjectRepo(): Promise<void> {
  await mkdir(join(projectDir, OWNED_PREFIX), { recursive: true });
  await writeFile(join(projectDir, "README.md"), "# fixture project\n", "utf8");
  await writeFile(join(projectDir, OWNED_PREFIX, "base.ts"), "export const base = 1;\n", "utf8");
  runFixtureGit(projectDir, ["init", "-q", "-b", "main"]);
  runFixtureGit(projectDir, ["add", "--", "README.md", OWNED_PREFIX]);
  runFixtureGit(projectDir, ["commit", "-q", "-m", "initial commit", "--no-verify"], {
    env: GIT_FIXTURE_IDENTITY_ENV,
  });
}

function seedIntakeState(options: {
  readonly requirement?: Requirement | undefined;
  readonly workUnits: readonly WorkUnit[];
  readonly changeSet: ChangeSet;
  readonly envelope: AuthorizationEnvelope;
}): void {
  const stateRoot = resolveStateRoot(env, PROJECT_HASH);
  createFileRegistry<ChangeSet>({
    path: join(stateRoot, CHANGE_SETS_FILE_NAME),
    schema: ChangeSetSchema,
  }).put(options.changeSet);
  const workUnitRegistry = createFileRegistry<WorkUnit>({
    path: join(stateRoot, WORK_UNITS_FILE_NAME),
    schema: WorkUnitSchema,
  });
  for (const unit of options.workUnits) workUnitRegistry.put(unit);
  createFileRegistry<AuthorizationEnvelope>({
    path: join(stateRoot, AUTHORIZATION_ENVELOPES_FILE_NAME),
    schema: AuthorizationEnvelopeSchema,
  }).put(options.envelope);
  if (options.requirement !== undefined) {
    createFileRegistry<Requirement>({
      path: join(stateRoot, REQUIREMENTS_FILE_NAME),
      schema: RequirementSchema,
    }).put(options.requirement);
  }
}

async function seedApprovalSeal(criteriaHash: string): Promise<void> {
  const store = createJournalStore({ journalDir: resolveJournalDir(env, PROJECT_HASH) });
  await journalCriteriaSeal(store, {
    changeSetId: CHANGE_SET_ID,
    criteriaHashes: { [REQ_ID]: criteriaHash },
  });
}

function changeSetFixture(integrationOrder: readonly string[]): ChangeSet {
  return buildChangeSet({
    id: CHANGE_SET_ID,
    authorizationEnvelopeId: ENVELOPE_ID,
    state: "ready",
    integrationOrder: [...integrationOrder],
  });
}

function unitFixture(id: string, title: string): WorkUnit {
  return buildWorkUnit({
    id,
    changeSetId: CHANGE_SET_ID,
    dependsOn: [],
    attemptStatus: "pending",
    requirementIds: [REQ_ID],
    title,
    ownedPaths: [`${OWNED_PREFIX}/`],
  });
}

/** The file each fake worker writes into the worktree it is handed — one per unit, so a two-unit run's integrated tree must hold both. */
function unitFilePath(workUnitId: string): string {
  return `${OWNED_PREFIX}/unit-${workUnitId.slice(0, 8)}.ts`;
}

/** A TRACKED file both units overwrite in the collide case — a real `merge-tree` conflict, not a fabricated one. */
const SHARED_FILE_PATH = `${OWNED_PREFIX}/base.ts`;

interface BootOptions {
  /**
   * Observes the pipeline's own checkpoints. Used to land a tamper AFTER the
   * drive has fully completed — i.e. after every unit's own completion check has
   * already passed — which is the one window only the whole-set gate at
   * `final_verifying` can see. An OBSERVER: it cannot supply a registry, skip a
   * firing or change a verdict.
   */
  readonly onPipelineStep?: (step: PostCompletionStep) => void | Promise<void>;
  /**
   * Every unit writes the SAME tracked file, each with its own content, so the
   * second candidate genuinely conflicts with the first once it has integrated.
   */
  readonly collide?: boolean;
}

/**
 * Boots the daemon the way `packages/cli/src/bin/supervisord.ts` does, with
 * ONLY the engine adapter injected. Every git seam is production default.
 */
async function bootDaemon(options: BootOptions = {}): Promise<ComposedSupervisor> {
  return composeSupervisor({
    env,
    projectHash: PROJECT_HASH,
    peerAuth: { reader: readPeerCredentialsLinux },
    createRunDispatcher: (deps: SupervisorDependencies) =>
      createRealRunDispatcher({
        deps: deps as RealRunDispatcherOptions["deps"],
        projectDir,
        xdgEnv: env,
        projectHash: PROJECT_HASH,
        auth: { kind: "oauthToken", token: PLACEHOLDER_ENGINE_CREDENTIAL },
        serviceEmail: "fixture@crabgic.invalid",
        loadPolicy: () => ({
          status: "loaded" as const,
          policy: FIXTURE_POLICY,
          digest: "sha256:fixture",
        }),
        // The ONLY seam: a fake engine that makes REAL edits in the REAL
        // worktree it is handed, then reports success. Worker output is
        // uncommitted — exactly as production leaves it.
        createAdapter: async (ctx, worktreePath) => {
          const relative =
            options.collide === true ? SHARED_FILE_PATH : unitFilePath(ctx.workUnit.id);
          const target = join(worktreePath, relative);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, `export const unit = "${ctx.workUnit.title}";\n`, "utf8");
          return new FakeEngineAdapter(
            buildFakeEngineScript({
              structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
            }),
          );
        },
        ...(options.onPipelineStep !== undefined
          ? { onPostCompletionStep: options.onPipelineStep }
          : {}),
        onDriveError: (_runId, err) => {
          driveErrors.push(err instanceof Error ? err.message : String(err));
        },
      }),
  });
}

async function dispatchAndSettle(daemon: ComposedSupervisor): Promise<string> {
  const dispatcher = daemon.deps.runDispatcher;
  if (dispatcher === undefined) throw new Error("the composed daemon has no run dispatcher");
  const outcome = await dispatcher.dispatch(CHANGE_SET_ID);
  expect(outcome.accepted).toBe(true);
  await dispatcher.drain({ timeoutMs: 120_000, graceMs: 2_000 });
  if (outcome.runId === undefined) throw new Error("an accepted dispatch minted no run id");
  return outcome.runId;
}

function readerStore(): JournalStore {
  return createJournalStore({ journalDir: resolveJournalDir(env, PROJECT_HASH) });
}

/** Every `evidence_pointer` payload this journal recorded, in append order. */
async function evidenceRecords(): Promise<readonly EvidenceRecord[]> {
  const found: EvidenceRecord[] = [];
  for await (const entry of readerStore().queryEntries({ type: "evidence_pointer" })) {
    if (entry.type !== "evidence_pointer") continue;
    found.push(entry.payload);
  }
  return found;
}

/** Every run-lifecycle state this run was journaled into, in append order. */
async function runTransitions(runId: string): Promise<readonly string[]> {
  const found: string[] = [];
  for await (const entry of readerStore().queryEntries({ type: "run_transition", runId })) {
    if (entry.type !== "run_transition") continue;
    found.push(entry.payload.to);
  }
  return found;
}

/**
 * The branch this run published, resolved INDEPENDENTLY out of the fixture
 * user repo — every local head that is not the fixture's own `main`. Nothing
 * the pipeline returned is consulted.
 */
function publishedBranches(): readonly string[] {
  return runFixtureGit(projectDir, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "main");
}

/** `git rev-parse` of `ref` in the fixture user repo — the independent resolution the evidence `objectId` is compared against. */
function revParse(ref: string): string {
  return runFixtureGit(projectDir, ["rev-parse", "--verify", ref]).trim();
}

/**
 * Every `refs/crabgic/…` ref in the CONTROL clone — the run-scoped
 * integration refs. Enumerated by namespace rather than reconstructed from the
 * pipeline's own naming helper, so the test resolves the tip independently.
 */
function controlIntegrationRefs(): readonly string[] {
  return runFixtureGit(resolveGitControlDir(env, PROJECT_HASH), [
    "for-each-ref",
    "--format=%(refname)",
    "refs/crabgic/",
  ])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** `git rev-parse` of `ref` in the control clone. */
function controlRevParse(ref: string): string {
  return runFixtureGit(resolveGitControlDir(env, PROJECT_HASH), [
    "rev-parse",
    "--verify",
    ref,
  ]).trim();
}

/** Every path in `ref`'s tree, read out of real git. */
function treePaths(ref: string): readonly string[] {
  return runFixtureGit(projectDir, ["ls-tree", "-r", "--name-only", ref])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

describe("a completed run walks to published_local through a fired gate (defect 14-gate-registry-never-composed)", () => {
  it("T1 — one unit: the run publishes, and the acceptance evidence binds the independently-resolved branch tip", async () => {
    const approved = buildRequirement({ id: REQ_ID, acceptanceCriteria: [...APPROVED_CRITERIA] });
    await seedApprovalSeal(approved.criteriaHash);
    seedIntakeState({
      requirement: approved,
      workUnits: [unitFixture(UNIT_A_ID, "add the greeting export")],
      changeSet: changeSetFixture([UNIT_A_ID]),
      envelope: buildAuthorizationEnvelope({
        id: ENVELOPE_ID,
        changeSetId: CHANGE_SET_ID,
        ownedPaths: [`${OWNED_PREFIX}/`],
      }),
    });

    composed = await bootDaemon();
    const runId = await dispatchAndSettle(composed);

    expect(driveErrors).toEqual([]);
    // (a) the terminal state no run had ever reached.
    expect(composed.deps.runs.get(runId)?.runState).toBe("published_local");
    // The whole declared walk is on the record, not just its endpoints.
    expect(await runTransitions(runId)).toStrictEqual([
      "awaiting_approval",
      "ready",
      "running",
      "verifying",
      "integrating",
      "final_verifying",
      "published_local",
    ]);

    // (b) the gate fired, and its evidence is bound to the TRUE tip.
    const branches = publishedBranches();
    expect(branches).toHaveLength(1);
    const publishedTip = revParse(branches[0]!);
    const acceptance = (await evidenceRecords()).filter(
      (record) => record.gateTag === "acceptance",
    );
    expect(acceptance).toHaveLength(1);
    expect(acceptance[0]?.gateVerdict).toBe("passed");
    expect(acceptance[0]?.objectId).toBe(publishedTip);
    expect(acceptance[0]?.changeSetId).toBe(CHANGE_SET_ID);
    // `final_verifying` has no single owning unit — the context omits it.
    expect(acceptance[0]?.workUnitId).toBeUndefined();

    // (c) the published tree really carries the worker's edit.
    expect(treePaths(branches[0]!)).toContain(unitFilePath(UNIT_A_ID));
  }, 180_000);

  it("T3 — two units: the evidence objectId is the tip whose tree holds BOTH edits, never a per-unit candidate", async () => {
    const approved = buildRequirement({ id: REQ_ID, acceptanceCriteria: [...APPROVED_CRITERIA] });
    await seedApprovalSeal(approved.criteriaHash);
    seedIntakeState({
      requirement: approved,
      workUnits: [
        unitFixture(UNIT_A_ID, "add the greeting export"),
        unitFixture(UNIT_B_ID, "add the farewell export"),
      ],
      changeSet: changeSetFixture([UNIT_A_ID, UNIT_B_ID]),
      envelope: buildAuthorizationEnvelope({
        id: ENVELOPE_ID,
        changeSetId: CHANGE_SET_ID,
        ownedPaths: [`${OWNED_PREFIX}/`],
      }),
    });

    composed = await bootDaemon();
    const runId = await dispatchAndSettle(composed);

    expect(driveErrors).toEqual([]);
    expect(composed.deps.runs.get(runId)?.runState).toBe("published_local");

    const branches = publishedBranches();
    expect(branches).toHaveLength(1);
    const publishedTip = revParse(branches[0]!);
    const paths = treePaths(branches[0]!);
    // The union only exists AFTER integration — no single unit's candidate
    // commit holds both files, so a cached per-unit object id cannot pass.
    expect(paths).toContain(unitFilePath(UNIT_A_ID));
    expect(paths).toContain(unitFilePath(UNIT_B_ID));

    const acceptance = (await evidenceRecords()).filter(
      (record) => record.gateTag === "acceptance",
    );
    expect(acceptance).toHaveLength(1);
    expect(acceptance[0]?.objectId).toBe(publishedTip);
    expect(acceptance[0]?.gateVerdict).toBe("passed");
  }, 180_000);

  it("T2 — a tamper landing AFTER every unit passed fails the run at the gate, naming the requirement", async () => {
    const approved = buildRequirement({ id: REQ_ID, acceptanceCriteria: [...APPROVED_CRITERIA] });
    // Self-consistent by construction: its own `criteriaHash` matches its
    // edited criteria, so only the journaled seal can catch it.
    const tampered = buildRequirement({ id: REQ_ID, acceptanceCriteria: [...TAMPERED_CRITERIA] });
    expect(tampered.criteriaHash).not.toBe(approved.criteriaHash);

    await seedApprovalSeal(approved.criteriaHash);
    seedIntakeState({
      requirement: approved,
      workUnits: [unitFixture(UNIT_A_ID, "add the greeting export")],
      changeSet: changeSetFixture([UNIT_A_ID]),
      envelope: buildAuthorizationEnvelope({
        id: ENVELOPE_ID,
        changeSetId: CHANGE_SET_ID,
        ownedPaths: [`${OWNED_PREFIX}/`],
      }),
    });

    composed = await bootDaemon({
      // THE WINDOW: the drive has finished, so the unit's own completion check
      // already passed against the UNTAMPERED record; the edit lands afterwards.
      // Only the whole-set gate at `final_verifying` can see it.
      onPipelineStep: (step) => {
        if (step !== "before-verifying") return;
        const stateRoot = resolveStateRoot(env, PROJECT_HASH);
        createFileRegistry<Requirement>({
          path: join(stateRoot, REQUIREMENTS_FILE_NAME),
          schema: RequirementSchema,
        }).put(tampered);
      },
    });
    const runId = await dispatchAndSettle(composed);

    expect(composed.deps.runs.get(runId)?.runState).toBe("failed");
    // Nothing was published.
    expect(publishedBranches()).toEqual([]);

    // THE TYPED VERDICT, on the record. `EvidenceRecord` has no `detail`
    // member, so the identifying tuple is what the journal carries: the
    // `acceptance` tag, a `failed` verdict, a non-zero exit status, and the
    // integrated object id the refusal is about — resolved INDEPENDENTLY out
    // of the control clone's own ref store, since a failed run publishes
    // nothing to rev-parse in the user repo.
    const acceptance = (await evidenceRecords()).filter(
      (record) => record.gateTag === "acceptance",
    );
    expect(acceptance).toHaveLength(1);
    expect(acceptance[0]?.gateVerdict).toBe("failed");
    expect(acceptance[0]?.exitStatus).toBe(1);
    const integrationRefs = controlIntegrationRefs();
    expect(integrationRefs).toHaveLength(1);
    expect(acceptance[0]?.objectId).toBe(controlRevParse(integrationRefs[0]!));

    // The refusal NAMES the requirement and the typed seal reason, so it can
    // never be satisfied by an unrelated failure (no policy, no envelope, a
    // broken worker). The gate's own `detail` rides the operator-facing error
    // channel rather than the journal — see the pipeline's doc comment.
    expect(driveErrors.join(" ")).toContain(REQ_ID);
    expect(driveErrors.join(" ")).toContain("approval_seal_mismatch");
    // The attacker-authored criteria text never leaks, into either channel.
    expect(JSON.stringify(acceptance[0])).not.toContain("skips the auth check");
    expect(driveErrors.join(" ")).not.toContain("skips the auth check");
  }, 180_000);

  it("T4 — a REAL cross-unit conflict settles the run blocked, with the typed resolution units journaled", async () => {
    const approved = buildRequirement({ id: REQ_ID, acceptanceCriteria: [...APPROVED_CRITERIA] });
    await seedApprovalSeal(approved.criteriaHash);
    seedIntakeState({
      requirement: approved,
      workUnits: [
        unitFixture(UNIT_A_ID, "rewrite the base export"),
        unitFixture(UNIT_B_ID, "rewrite the base export differently"),
      ],
      changeSet: changeSetFixture([UNIT_A_ID, UNIT_B_ID]),
      envelope: buildAuthorizationEnvelope({
        id: ENVELOPE_ID,
        changeSetId: CHANGE_SET_ID,
        ownedPaths: [`${OWNED_PREFIX}/`],
      }),
    });

    // Both workers overwrite the SAME tracked line. The first candidate
    // integrates and advances the tip; the second is then preflighted against
    // that ADVANCED tip and conflicts for real — which is only detectable
    // because the tip advances. Against the frozen base both would merge
    // cleanly, which is the documented vacuity `merge-preflight.ts` warns about.
    composed = await bootDaemon({ collide: true });
    const runId = await dispatchAndSettle(composed);

    expect(composed.deps.runs.get(runId)?.runState).toBe("blocked");
    expect(publishedBranches()).toEqual([]);
    // No gate fired: the walk never reached `final_verifying`.
    expect((await evidenceRecords()).filter((r) => r.gateTag === "acceptance")).toEqual([]);
    expect(await runTransitions(runId)).toStrictEqual([
      "awaiting_approval",
      "ready",
      "running",
      "verifying",
      "integrating",
      "blocked",
    ]);

    // NOT merely "blocked": the typed resolution work units are on the record,
    // naming the conflicted path. A crashed pipeline would also block.
    const conflicts: string[] = [];
    for await (const entry of readerStore().queryEntries({ type: "adjudication_decision" })) {
      if (entry.type !== "adjudication_decision") continue;
      if (entry.payload.decision !== "integration_conflict") continue;
      conflicts.push(entry.payload.rationale);
    }
    expect(conflicts).toHaveLength(1);
    const parsed = JSON.parse(conflicts[0]!) as {
      readonly resolutionWorkUnits: readonly {
        readonly role: string;
        readonly ownedPaths: readonly string[];
      }[];
    };
    expect(parsed.resolutionWorkUnits).toHaveLength(1);
    expect(parsed.resolutionWorkUnits[0]?.role).toBe("merge-conflict-resolution");
    expect(parsed.resolutionWorkUnits[0]?.ownedPaths).toEqual([SHARED_FILE_PATH]);
    expect(driveErrors.join(" ")).toContain(SHARED_FILE_PATH);
  }, 180_000);
});
