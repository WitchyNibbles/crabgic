/**
 * The routine approval path (ledger Gap 18): contained work runs with no
 * prompt and no token; everything else stops. These tests pin the deny
 * directions hardest, because a gate that fails open is not a gate.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, findLatestCriteriaSeal, type JournalStore } from "@crabgic/journal";
import {
  createChangeSetsRegistry,
  createIntentContractsRegistry,
  createRequirementsRegistry,
  createWorkUnitsRegistry,
} from "@crabgic/supervisor";
import {
  EnvelopePolicySchema,
  verifyCriteriaSeal,
  type AuthorizationEnvelope,
  type ChangeSet,
  type EnvelopePolicy,
  type Requirement,
} from "@crabgic/contracts";
import {
  buildAuthorizationEnvelope,
  buildChangeSet,
  buildIntentContract,
  buildRequirement,
  buildWorkUnit,
} from "@crabgic/testkit";
import type { LoadPolicyResult } from "../policy/policy-store.js";
import { applyStandingApproval, type StandingApprovalDeps } from "./standing-approval.js";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-cli-standing-approval-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function policy(overrides: Partial<EnvelopePolicy> = {}): EnvelopePolicy {
  return EnvelopePolicySchema.parse({
    maxWorkerTurnsPerAttempt: 40,
    schemaVersion: 1,
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    createdAt: "2026-01-01T00:00:00.000Z",
    allowedPathPrefixes: ["src"],
    ...overrides,
  });
}

interface Seeded {
  readonly deps: StandingApprovalDeps;
  readonly changeSet: ChangeSet;
  readonly envelope: AuthorizationEnvelope;
  /** The single `Requirement` record this ChangeSet declares — returned so a test can assert the SEALED hash set, not merely that a seal exists (roadmap/24 exit criterion 4). */
  readonly requirement: Requirement;
}

/** A ChangeSet awaiting approval, its envelope, and a contract whose single requirement IS owned by a WorkUnit. */
function seed(
  loadPolicy: () => LoadPolicyResult,
  options: {
    readonly ownedPaths?: string[];
    readonly commands?: string[];
    readonly mapRequirement?: boolean;
  } = {},
): Seeded {
  const changeSets = createChangeSetsRegistry();
  const intentContracts = createIntentContractsRegistry();
  const requirements = createRequirementsRegistry();
  const workUnits = createWorkUnitsRegistry();

  const requirementId = randomUUID();
  const envelope = buildAuthorizationEnvelope({
    id: randomUUID(),
    ownedPaths: options.ownedPaths ?? ["src/login"],
    commands: options.commands ?? [],
  });
  const contract = buildIntentContract({ id: randomUUID(), requirementIds: [requirementId] });
  intentContracts.put(contract);
  // The record behind the declared id — roadmap/24. Approval seals the
  // criteria, so a contract declaring a requirement whose record is missing is
  // now refused rather than approved-with-nothing-sealed.
  const requirement = buildRequirement({
    id: requirementId,
    intentContractId: contract.id,
    acceptanceCriteria: ["The login form submits", "The login form rejects an empty password"],
  });
  requirements.put(requirement);
  const changeSet = buildChangeSet({
    id: randomUUID(),
    state: "awaiting_approval",
    authorizationEnvelopeId: envelope.id,
    intentContractId: contract.id,
  });
  changeSets.put(changeSet);
  if (options.mapRequirement ?? true) {
    workUnits.put(
      buildWorkUnit({
        id: randomUUID(),
        changeSetId: changeSet.id,
        requirementIds: [requirementId],
      }),
    );
  }

  return {
    changeSet,
    envelope,
    requirement,
    deps: { journal: store, changeSets, workUnits, intentContracts, requirements, loadPolicy },
  };
}

/** Every `adjudication_decision` this journal recorded. */
async function adjudications(): Promise<readonly { decision?: string; rationale?: string }[]> {
  const found: { decision?: string; rationale?: string }[] = [];
  for await (const entry of store.queryEntries({})) {
    if (entry.type === "adjudication_decision") {
      found.push(entry.payload as { decision?: string; rationale?: string });
    }
  }
  return found;
}

describe("applyStandingApproval", () => {
  it("approves a contained envelope with no prompt and no token, and journals the authorizing digest", async () => {
    const loaded: LoadPolicyResult = { status: "loaded", policy: policy(), digest: "sha256:pol" };
    const seeded = seed(() => loaded);

    const outcome = await applyStandingApproval(seeded.changeSet, seeded.envelope, seeded.deps);

    expect(outcome.status).toBe("approved");
    if (outcome.status !== "approved") throw new Error("unreachable");
    expect(outcome.changeSet.state).toBe("ready");
    expect(outcome.policyDigest).toBe("sha256:pol");
    expect(seeded.deps.changeSets.get(seeded.changeSet.id)?.state).toBe("ready");

    // Gap 18 part 4: evidence must answer what the human was standing behind.
    // Two decisions now, and they answer different questions: what authority
    // was standing behind this, and what bar was it approved against (roadmap/24).
    const recorded = await adjudications();
    expect(recorded.map((entry) => entry.decision)).toStrictEqual([
      "policy_contained",
      "criteria_sealed",
    ]);
    expect(recorded[0]!.rationale).toContain("sha256:pol");

    // roadmap/24 exit criterion 4, THE STANDING-APPROVAL PATH. The
    // `criteria_sealed` LABEL above is not the criterion — the criterion is
    // that the seal itself is journaled, so assert the full
    // requirement-to-criteriaHash SET, read back through the same
    // `findLatestCriteriaSeal` the dispatcher uses at completion time. A seal
    // that silently dropped this requirement would read as `no_approval_seal`
    // mid-run, which is exactly the failure this path must not be able to
    // produce.
    const seal = await findLatestCriteriaSeal(store, seeded.changeSet.id);
    expect(seal).toBeDefined();
    expect(seal!.changeSetId).toBe(seeded.changeSet.id);
    expect(seal!.criteriaHashes).toStrictEqual({
      [seeded.requirement.id]: seeded.requirement.criteriaHash,
    });
    expect(verifyCriteriaSeal(seeded.requirement, seal).ok).toBe(true);
  });

  /**
   * The other half of the same criterion: "absence of a seal for a
   * post-phase approval is impossible to produce through either path." An
   * escalated (refused) standing approval must leave no seal behind.
   */
  it("leaves no seal behind when the standing policy refuses (roadmap/24 exit criterion 4)", async () => {
    const loaded: LoadPolicyResult = { status: "loaded", policy: policy(), digest: "sha256:pol" };
    const seeded = seed(() => loaded, { ownedPaths: ["infra/secrets"] });

    const outcome = await applyStandingApproval(seeded.changeSet, seeded.envelope, seeded.deps);

    expect(outcome.status).toBe("escalate");
    expect(await findLatestCriteriaSeal(store, seeded.changeSet.id)).toBeUndefined();
  });

  it("escalates an envelope reaching outside the policy, naming EVERY escaping dimension", async () => {
    const loaded: LoadPolicyResult = { status: "loaded", policy: policy(), digest: "sha256:pol" };
    const seeded = seed(() => loaded, {
      ownedPaths: ["src/login", "infra/secrets"],
      commands: ["rm -rf /"],
    });

    const outcome = await applyStandingApproval(seeded.changeSet, seeded.envelope, seeded.deps);

    expect(outcome.status).toBe("escalate");
    if (outcome.status !== "escalate") throw new Error("unreachable");
    expect(outcome.reason).toContain("infra/secrets");
    expect(outcome.reason).toContain("rm -rf /");
    // Never a partial grant of the contained subset, and never a silent ready.
    expect(seeded.deps.changeSets.get(seeded.changeSet.id)?.state).toBe("awaiting_approval");
    expect(await adjudications()).toHaveLength(0);
  });

  it("escalates when no policy exists — absent means deny, never skip", async () => {
    const seeded = seed(() => ({ status: "absent" }) as LoadPolicyResult);
    const outcome = await applyStandingApproval(seeded.changeSet, seeded.envelope, seeded.deps);
    expect(outcome.status).toBe("escalate");
    if (outcome.status !== "escalate") throw new Error("unreachable");
    expect(outcome.reason).toContain("no standing EnvelopePolicy");
    expect(seeded.deps.changeSets.get(seeded.changeSet.id)?.state).toBe("awaiting_approval");
  });

  it("escalates an unreadable policy, and says so rather than reporting it as absent", async () => {
    const seeded = seed(
      () => ({ status: "invalid", reason: "policy file is not valid JSON" }) as LoadPolicyResult,
    );
    const outcome = await applyStandingApproval(seeded.changeSet, seeded.envelope, seeded.deps);
    expect(outcome.status).toBe("escalate");
    if (outcome.status !== "escalate") throw new Error("unreachable");
    expect(outcome.reason).toContain("not valid JSON");
  });

  it("escalates a TRANSIENT policy failure without ever assuming an approval", async () => {
    const seeded = seed(
      () =>
        ({
          status: "invalid",
          reason: "too many open files",
          transient: true,
        }) as LoadPolicyResult,
    );
    const outcome = await applyStandingApproval(seeded.changeSet, seeded.envelope, seeded.deps);
    expect(outcome.status).toBe("escalate");
    if (outcome.status !== "escalate") throw new Error("unreachable");
    expect(outcome.reason).toContain("rather than assuming one");
  });

  it("escalates when the loader itself throws, instead of propagating a crash into intake", async () => {
    const seeded = seed(() => {
      throw new Error("EIO reading policy");
    });
    const outcome = await applyStandingApproval(seeded.changeSet, seeded.envelope, seeded.deps);
    expect(outcome.status).toBe("escalate");
    if (outcome.status !== "escalate") throw new Error("unreachable");
    expect(outcome.reason).toContain("EIO reading policy");
  });

  it("reports an unowned requirement as not_ready — no approval route fixes a planning gap", async () => {
    const loaded: LoadPolicyResult = { status: "loaded", policy: policy(), digest: "sha256:pol" };
    const seeded = seed(() => loaded, { mapRequirement: false });

    const outcome = await applyStandingApproval(seeded.changeSet, seeded.envelope, seeded.deps);

    expect(outcome.status).toBe("not_ready");
    if (outcome.status !== "not_ready") throw new Error("unreachable");
    expect(outcome.reason).toContain("no owning WorkUnit");
    // Nothing journaled and nothing transitioned: readiness is checked before
    // either, so a contained-but-unplannable change set leaves no trace of an
    // authority decision that was never acted on.
    expect(seeded.deps.changeSets.get(seeded.changeSet.id)?.state).toBe("awaiting_approval");
    expect(await adjudications()).toHaveLength(0);
  });

  it("reports a missing IntentContract as not_ready rather than approving on a requirement set it cannot read", async () => {
    const loaded: LoadPolicyResult = { status: "loaded", policy: policy(), digest: "sha256:pol" };
    const seeded = seed(() => loaded);
    const orphan = buildChangeSet({
      id: randomUUID(),
      state: "awaiting_approval",
      authorizationEnvelopeId: seeded.envelope.id,
      intentContractId: randomUUID(),
    });
    seeded.deps.changeSets.put(orphan);

    const outcome = await applyStandingApproval(orphan, seeded.envelope, seeded.deps);
    expect(outcome.status).toBe("not_ready");
    if (outcome.status !== "not_ready") throw new Error("unreachable");
    expect(outcome.reason).toContain("no resolvable IntentContract");
  });

  /**
   * FOUND BY RUNNING THE BUILT BINARY TWICE (2026-07-30). Intake is idempotent
   * by design, so a second `crabgic run` on the same request replays a
   * ChangeSet this path already advanced to `ready`. Before the fix that threw
   * `IllegalTransitionError: ready -> ready` straight out of the command —
   * after journaling a second authorization for work already authorized.
   */
  it("is idempotent for an already-ready ChangeSet: approves, journals NOTHING new, and never throws", async () => {
    const loaded: LoadPolicyResult = { status: "loaded", policy: policy(), digest: "sha256:pol" };
    const seeded = seed(() => loaded);

    const first = await applyStandingApproval(seeded.changeSet, seeded.envelope, seeded.deps);
    expect(first.status).toBe("approved");
    if (first.status !== "approved") throw new Error("unreachable");
    expect(first.alreadyApproved).toBeUndefined();
    // The authorization and its criteria seal — one each, not one of each per replay.
    expect(await adjudications()).toHaveLength(2);

    // The replay: the SAME request, re-read from the registry as `run` would.
    const replayed = seeded.deps.changeSets.get(seeded.changeSet.id)!;
    expect(replayed.state).toBe("ready");
    const second = await applyStandingApproval(replayed, seeded.envelope, seeded.deps);

    expect(second.status).toBe("approved");
    if (second.status !== "approved") throw new Error("unreachable");
    expect(second.alreadyApproved).toBe(true);
    // Still the SAME two the first call wrote — one authorization and one
    // criteria seal. The replay added neither, which is the whole point.
    expect((await adjudications()).map((entry) => entry.decision)).toStrictEqual([
      "policy_contained",
      "criteria_sealed",
    ]);
  });

  it("still refuses a replay whose policy has NARROWED since it was approved", async () => {
    const wide: LoadPolicyResult = { status: "loaded", policy: policy(), digest: "sha256:wide" };
    const seeded = seed(() => wide);
    await applyStandingApproval(seeded.changeSet, seeded.envelope, seeded.deps);
    const replayed = seeded.deps.changeSets.get(seeded.changeSet.id)!;

    // The owner has since narrowed the policy so it no longer covers this work.
    const narrowed: StandingApprovalDeps = {
      ...seeded.deps,
      loadPolicy: () => ({
        status: "loaded",
        policy: policy({ allowedPathPrefixes: ["docs"] }),
        digest: "sha256:narrow",
      }),
    };
    const outcome = await applyStandingApproval(replayed, seeded.envelope, narrowed);
    expect(outcome.status).toBe("escalate");
  });

  it.each(["failed", "cancelled", "blocked", "draft"] as const)(
    "refuses to treat a %s ChangeSet as approvable",
    async (state) => {
      const loaded: LoadPolicyResult = { status: "loaded", policy: policy(), digest: "sha256:pol" };
      const seeded = seed(() => loaded);
      const stranded = { ...seeded.changeSet, state };
      seeded.deps.changeSets.put(stranded);

      const outcome = await applyStandingApproval(stranded, seeded.envelope, seeded.deps);
      expect(outcome.status).toBe("not_ready");
      if (outcome.status !== "not_ready") throw new Error("unreachable");
      expect(outcome.reason).toContain(state);
      expect(await adjudications()).toHaveLength(0);
    },
  );

  it("refuses a vacuous policy that grants nothing, rather than treating empty as permissive", async () => {
    const loaded: LoadPolicyResult = {
      status: "loaded",
      policy: policy({ allowedPathPrefixes: [] }),
      digest: "sha256:empty",
    };
    const seeded = seed(() => loaded);
    const outcome = await applyStandingApproval(seeded.changeSet, seeded.envelope, seeded.deps);
    expect(outcome.status).toBe("escalate");
  });
});
