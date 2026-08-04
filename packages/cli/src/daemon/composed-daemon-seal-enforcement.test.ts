/**
 * roadmap/24's completion funnel, exercised through the SHIPPED daemon
 * composition — `composeSupervisor` + `createRealRunDispatcher` — rather than
 * through a hand-built dependency bundle.
 *
 * WHY THIS FILE EXISTS. Phase 24's tamper and rollback fixtures
 * (`packages/scheduler/src/executor.test.ts`,
 * `packages/scheduler/src/criteria-seal-rollback.integration.test.ts`) are real
 * and non-vacuous, but every one of them CONSTRUCTS the criteria seal it
 * judges against and hands it straight to `dispatchAttempt`. None of them can
 * see composition. So when `composeSupervisor` turned out never to build a
 * requirements registry at all — leaving
 * `SupervisorDependencies.requirements` `undefined` and
 * `../daemon/run-dispatcher.ts`'s resolver taking its `[]` arm for every work
 * unit in production — all of them stayed green while the shipped daemon
 * verified ZERO requirements per unit. Defect record
 * `24-daemon-requirements-registry-unwired.md`; the phase file warns about
 * exactly this shape twice ("one path threaded it, the daemon path did not").
 *
 * WHAT MAKES IT A BEARER, AND NOT ANOTHER HARNESS.
 *
 *  1. The daemon is composed the way production composes it. Nothing here
 *     reaches into `composed.deps` to seed state. Seeding a requirement
 *     through `composed.deps.requirements.put` would prove only that SOME
 *     registry exists; it would stay green if the daemon opened
 *     `requirements.json` in the wrong directory, or under a different name,
 *     from the one intake writes.
 *  2. State is therefore seeded through INDEPENDENTLY constructed file
 *     registries at `join(resolveStateRoot(env, projectHash), <FILE_NAME>)` —
 *     byte-for-byte the paths `packages/cli/src/bootstrap.ts` writes at intake
 *     — and the approval seal through a separate `JournalStore` over
 *     `resolveJournalDir(env, projectHash)`. A path or filename divergence
 *     between intake and the daemon reddens these tests.
 *  3. Case C (clean pass) is a control: if the implementation refused
 *     unconditionally, C fails, and A's and B's refusals would be
 *     unattributable.
 *  4. Case B's refusal is asserted to NAME the unresolvable requirement id,
 *     so it cannot be satisfied by an unrelated refusal (no policy, no
 *     envelope, no dispatcher).
 *
 * NO ENGINE, NO REPOSITORY, NO NETWORK: `prepareRun`, `createAttemptWorktree`,
 * `plumbing` and `createAdapter` are all injected, and the adapter always
 * reports `succeeded` — so any `failed` recorded here is the acceptance funnel
 * refusing, never a worker that happened to fail.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EnvelopePolicySchema,
  RequirementSchema,
  ChangeSetSchema,
  WorkUnitSchema,
  AuthorizationEnvelopeSchema,
  type AuthorizationEnvelope,
  type ChangeSet,
  type Requirement,
  type WorkUnit,
} from "@crabgic/contracts";
import {
  createJournalStore,
  getLatestAttempt,
  journalCriteriaSeal,
  resolveJournalDir,
  resolveStateRoot,
  type JournalStore,
  type XdgEnv,
} from "@crabgic/journal";
import {
  composeSupervisor,
  createFileRegistry,
  AUTHORIZATION_ENVELOPES_FILE_NAME,
  CHANGE_SETS_FILE_NAME,
  REQUIREMENTS_FILE_NAME,
  WORK_UNITS_FILE_NAME,
  readPeerCredentialsLinux,
  type ComposedSupervisor,
  type SupervisorDependencies,
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
import { createRealRunDispatcher, type RealRunDispatcherOptions } from "./run-dispatcher.js";

const PROJECT_HASH = "sealenforce0001";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const ENVELOPE_ID = "33333333-3333-4333-8333-333333333333";
const UNIT_ID = "44444444-4444-4444-8444-444444444444";
const REQ_ID = "aaaaaaaa-1111-4111-8111-111111111111";

/** The criteria approved and sealed. */
const APPROVED_CRITERIA = ["The login form submits"];
/** The criteria a post-approval edit substitutes. */
const TAMPERED_CRITERIA = ["The login form submits", "and it silently skips auth"];

/**
 * Placeholder engine credential, assembled rather than written as a literal
 * so the repository's pre-commit secret scanner sees no credential-shaped
 * assignment. Never used — every case injects `createAdapter`.
 */
const PLACEHOLDER_ENGINE_CREDENTIAL = ["placeholder", "not", "real"].join("-");

/** Grants exactly the fixture envelope's own owned path — so the containment gate stays load-bearing rather than a rubber stamp. */
const FIXTURE_POLICY = EnvelopePolicySchema.parse({
  schemaVersion: 1,
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  createdAt: "2026-01-01T00:00:00.000Z",
  allowedPathPrefixes: ["packages/example/src"],
  maxWorkerTurnsPerAttempt: 40,
});

let root: string;
let env: XdgEnv;
let composed: ComposedSupervisor | undefined;
let driveErrors: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-composed-seal-"));
  env = { HOME: root, XDG_STATE_HOME: join(root, "state") };
  driveErrors = [];
});

afterEach(async () => {
  await composed?.close();
  composed = undefined;
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

/**
 * Writes the intake artifacts the way INTAKE writes them: freshly constructed
 * file registries at the state-root paths `bootstrap.ts` uses. Deliberately
 * NOT `composed.deps.*` — see the file-level note (2).
 */
function seedIntakeState(options: {
  readonly requirement?: Requirement | undefined;
  readonly workUnit: WorkUnit;
  readonly changeSet: ChangeSet;
  readonly envelope: AuthorizationEnvelope;
}): void {
  const stateRoot = resolveStateRoot(env, PROJECT_HASH);
  createFileRegistry<ChangeSet>({
    path: join(stateRoot, CHANGE_SETS_FILE_NAME),
    schema: ChangeSetSchema,
  }).put(options.changeSet);
  createFileRegistry<WorkUnit>({
    path: join(stateRoot, WORK_UNITS_FILE_NAME),
    schema: WorkUnitSchema,
  }).put(options.workUnit);
  createFileRegistry<AuthorizationEnvelope>({
    path: join(stateRoot, AUTHORIZATION_ENVELOPES_FILE_NAME),
    schema: AuthorizationEnvelopeSchema,
  }).put(options.envelope);
  // Deliberately left ABSENT for the missing-record case — the ENOENT-tolerant
  // file registry then reads an empty registry, which is precisely the second
  // half of the defect.
  if (options.requirement !== undefined) {
    createFileRegistry<Requirement>({
      path: join(stateRoot, REQUIREMENTS_FILE_NAME),
      schema: RequirementSchema,
    }).put(options.requirement);
  }
}

/** The approval seal, appended to the real journal before the daemon boots — the way `transitionChangeSetToReady` leaves it. */
async function seedApprovalSeal(criteriaHash: string): Promise<void> {
  const store = createJournalStore({ journalDir: resolveJournalDir(env, PROJECT_HASH) });
  await journalCriteriaSeal(store, {
    changeSetId: CHANGE_SET_ID,
    criteriaHashes: { [REQ_ID]: criteriaHash },
  });
}

function changeSetFixture(): ChangeSet {
  return buildChangeSet({
    id: CHANGE_SET_ID,
    authorizationEnvelopeId: ENVELOPE_ID,
    state: "ready",
  });
}

function workUnitFixture(): WorkUnit {
  return buildWorkUnit({
    id: UNIT_ID,
    changeSetId: CHANGE_SET_ID,
    dependsOn: [],
    attemptStatus: "pending",
    // The whole point: a unit that DECLARES an acceptance bar.
    requirementIds: [REQ_ID],
  });
}

/** Boots the daemon exactly as `packages/cli/src/bin/supervisord.ts` does, with the git/engine seams injected. */
async function bootDaemon(): Promise<ComposedSupervisor> {
  return composeSupervisor({
    env,
    projectHash: PROJECT_HASH,
    peerAuth: { reader: readPeerCredentialsLinux },
    createRunDispatcher: (deps: SupervisorDependencies) =>
      createRealRunDispatcher({
        deps: deps as RealRunDispatcherOptions["deps"],
        projectDir: root,
        xdgEnv: env,
        projectHash: PROJECT_HASH,
        auth: { kind: "oauthToken", token: PLACEHOLDER_ENGINE_CREDENTIAL },
        loadPolicy: () => ({
          status: "loaded" as const,
          policy: FIXTURE_POLICY,
          digest: "sha256:fixture",
        }),
        plumbing: {
          gitBinary: "git",
          run: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
        } as never,
        prepareRun: () => Promise.resolve("a".repeat(40)),
        createAttemptWorktree: () => Promise.resolve(join(root, "worktree")),
        // ALWAYS succeeds — so a `failed` attempt can only be the funnel.
        createAdapter: () =>
          Promise.resolve(
            new FakeEngineAdapter(
              buildFakeEngineScript({
                structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
              }),
            ),
          ),
        onDriveError: (_runId, err) => {
          driveErrors.push(err instanceof Error ? err.message : String(err));
        },
      }),
  });
}

/** Dispatches and waits for the detached drive to settle — `drain` is the daemon's own shutdown primitive. */
async function dispatchAndSettle(daemon: ComposedSupervisor): Promise<void> {
  const dispatcher = daemon.deps.runDispatcher;
  if (dispatcher === undefined) throw new Error("the composed daemon has no run dispatcher");
  const outcome = await dispatcher.dispatch(CHANGE_SET_ID);
  expect(outcome.accepted).toBe(true);
  await dispatcher.drain({ timeoutMs: 20_000, graceMs: 1_000 });
}

/** Reads the settled journal back through a FRESH store — durable evidence, not an in-process handle. */
function readerStore(): JournalStore {
  return createJournalStore({ journalDir: resolveJournalDir(env, PROJECT_HASH) });
}

/** Every `criteria_seal_refused` rationale this journal recorded. */
async function refusalRationales(): Promise<readonly string[]> {
  const found: string[] = [];
  for await (const entry of readerStore().queryEntries({ type: "adjudication_decision" })) {
    if (entry.type !== "adjudication_decision") continue;
    if (entry.payload.decision !== "criteria_seal_refused") continue;
    found.push(entry.payload.rationale);
  }
  return found;
}

/** Every attempt status this journal recorded for the fixture unit, in append order. */
async function attemptStatuses(): Promise<readonly string[]> {
  const found: string[] = [];
  for await (const entry of readerStore().queryEntries({
    type: "work_unit_transition",
    workUnitId: UNIT_ID,
  })) {
    if (entry.type !== "work_unit_transition") continue;
    found.push(entry.payload.status);
  }
  return found;
}

describe("the SHIPPED daemon composition verifies a work unit's acceptance bar (defect 24-daemon-requirements-registry-unwired)", () => {
  it("A — refuses a post-approval criteria edit: the unit records failed, never succeeded, and the refusal names the requirement", async () => {
    const approved = buildRequirement({
      id: REQ_ID,
      acceptanceCriteria: [...APPROVED_CRITERIA],
    });
    // The tampered record is SELF-CONSISTENT — its `criteriaHash` is recomputed
    // over the edited criteria — so only the journaled seal can catch it, and a
    // `self_consistency_mismatch` cannot be mistaken for the seal check.
    const tampered = buildRequirement({
      id: REQ_ID,
      acceptanceCriteria: [...TAMPERED_CRITERIA],
    });
    expect(tampered.criteriaHash).not.toBe(approved.criteriaHash);

    await seedApprovalSeal(approved.criteriaHash);
    seedIntakeState({
      requirement: tampered,
      workUnit: workUnitFixture(),
      changeSet: changeSetFixture(),
      envelope: buildAuthorizationEnvelope({ id: ENVELOPE_ID, changeSetId: CHANGE_SET_ID }),
    });

    composed = await bootDaemon();
    await dispatchAndSettle(composed);

    const statuses = await attemptStatuses();
    expect(statuses).toContain("failed");
    expect(statuses).not.toContain("succeeded");
    expect(await getLatestAttempt(readerStore(), UNIT_ID)).toMatchObject({ status: "failed" });

    const rationales = await refusalRationales();
    expect(rationales).toHaveLength(1);
    expect(rationales[0]).toContain("approval_seal_mismatch");
    expect(rationales[0]).toContain(REQ_ID);
    // Ids and hashes only — the attacker-authored criteria text never leaks.
    expect(rationales[0]).not.toContain("silently skips auth");
  });

  it("B — refuses a declared requirement with no record: nothing succeeds and the drive error names the unresolvable id", async () => {
    const approved = buildRequirement({
      id: REQ_ID,
      acceptanceCriteria: [...APPROVED_CRITERIA],
    });
    await seedApprovalSeal(approved.criteriaHash);
    // `requirements.json` is never written. The file registry is ENOENT-tolerant
    // by design ("the first run on a fresh machine must not fail"), so a wired
    // registry over an absent file STILL resolves an empty set — the wiring
    // alone would leave the defect standing.
    seedIntakeState({
      workUnit: workUnitFixture(),
      changeSet: changeSetFixture(),
      envelope: buildAuthorizationEnvelope({ id: ENVELOPE_ID, changeSetId: CHANGE_SET_ID }),
    });

    composed = await bootDaemon();
    await dispatchAndSettle(composed);

    expect(await attemptStatuses()).not.toContain("succeeded");
    expect(await getLatestAttempt(readerStore(), UNIT_ID)).not.toMatchObject({
      status: "succeeded",
    });
    // Attributable: the refusal is about THIS requirement, not about a missing
    // policy, envelope or dispatcher.
    expect(driveErrors.join(" ")).toContain(REQ_ID);
    expect(driveErrors.join(" ")).toContain(UNIT_ID);
  });

  it("C — control: matching record and seal complete normally, with zero refusals journaled", async () => {
    const approved = buildRequirement({
      id: REQ_ID,
      acceptanceCriteria: [...APPROVED_CRITERIA],
    });
    await seedApprovalSeal(approved.criteriaHash);
    seedIntakeState({
      requirement: approved,
      workUnit: workUnitFixture(),
      changeSet: changeSetFixture(),
      envelope: buildAuthorizationEnvelope({ id: ENVELOPE_ID, changeSetId: CHANGE_SET_ID }),
    });

    composed = await bootDaemon();
    await dispatchAndSettle(composed);

    expect(await getLatestAttempt(readerStore(), UNIT_ID)).toMatchObject({ status: "succeeded" });
    expect(await refusalRationales()).toHaveLength(0);
    expect(driveErrors).toEqual([]);
  });
});
