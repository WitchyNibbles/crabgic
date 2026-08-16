/**
 * roadmap/24 exit criterion 1: "Approved requirements are durable: after
 * process restart, every requirement of an approved ChangeSet resolves by id
 * with its criteria and `criteriaHash` intact (integration test)."
 *
 * WHY A SEPARATE FILE, AND WHY IT IS NOT REDUNDANT WITH ITS NEIGHBOURS: the
 * three tests that looked like this criterion each miss half of it.
 * `../registries/file-registry.test.ts` reads a generic record back from a
 * second registry instance but never a `Requirement` and never a seal;
 * `./intake-pipeline.test.ts` persists real `Requirement`s but into the
 * IN-MEMORY registry, so nothing crosses a process boundary; and
 * `../registries/requirements-registry.test.ts` resolves by id with the hash
 * intact, also in memory. The criterion is the COMPOSITION — build, approve,
 * seal, drop everything, reload from disk, and still be able to judge — so it
 * is composed here rather than implied by three partial neighbours.
 *
 * The restart is simulated the only way it can be inside one process: every
 * live object is discarded and rebuilt over the SAME paths, using the same
 * `createFileRegistry` factory `@crabgic/cli`'s `bootstrap.ts` wires in
 * production. Nothing from process 1 is reachable from process 2 except the
 * bytes on disk.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, findLatestCriteriaSeal, type JournalStore } from "@crabgic/journal";
import {
  RequirementSchema,
  computeCriteriaHash,
  verifyCriteriaSeal,
  type Requirement,
} from "@crabgic/contracts";
import { createFileRegistry } from "../registries/file-registry.js";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import { createWorkUnitsRegistry } from "../registries/work-units-registry.js";
import { createAuthorizationEnvelopesRegistry } from "../registries/authorization-envelopes-registry.js";
import { createIntentContractsRegistry } from "../registries/intent-contracts-registry.js";
import { resolveRequirements } from "../registries/requirements-registry.js";
import { computeRequirementId } from "./contract-builder.js";
import { computeIntentContractId, runIntake, type IntakeRequest } from "./intake-pipeline.js";
import { transitionChangeSetToReady } from "./readiness-gate.js";
import type { StageCompletionRecord } from "@crabgic/contracts";
/**
 * R8: the design gate now guards `ready`. These cases assert requirement
 * DURABILITY across that transition, so they pass the gate rather than re-test
 * it — the gate has its own suite in `./readiness-gate.test.ts`.
 */
function designGateClosed(changeSetId: string): StageCompletionRecord[] {
  return [
    {
      schemaVersion: 1,
      changeSetId,
      stage: "design-gate",
      round: 1,
      artifactRef: "design-record:test",
      closedAt: "2026-08-16T00:00:00.000Z",
    },
  ];
}

const CHANGE_SET_ID = "11111111-1111-4111-8111-111111111111";
const WU_ID = "22222222-1111-4111-8111-111111111111";

const DRAFTS = [
  {
    section: "scope",
    title: "Add login form",
    description: "d",
    acceptanceCriteria: ["The login form submits", "The login form rejects an empty password"],
  },
  {
    section: "security",
    title: "Rate-limit the login endpoint",
    description: "d",
    acceptanceCriteria: ["Six failed attempts in a minute are refused"],
  },
] as const;

let root: string;
let journalDir: string;
let requirementsPath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-supervisor-requirement-durability-"));
  journalDir = join(root, "journal");
  requirementsPath = join(root, "registries", "requirements.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** The durable `Requirement` registry, over the SAME file every time — the production wiring (`@crabgic/cli`'s `bootstrap.ts`). */
function openRequirementsRegistry() {
  return createFileRegistry<Requirement>({ path: requirementsPath, schema: RequirementSchema });
}

/** A fresh `JournalStore` over the same append-only journal directory. */
function openJournal(): JournalStore {
  return createJournalStore({ journalDir });
}

function request(): IntakeRequest {
  const intentContractId = computeIntentContractId(CHANGE_SET_ID);
  return {
    requestKey: "repo:durability",
    id: CHANGE_SET_ID,
    createdAt: "2026-01-01T00:00:00.000Z",
    sections: {
      scope: "s",
      "non-goals": "n",
      audience: "a",
      compatibility: "c",
      security: "sec",
      performance: "p",
      observability: "o",
      rollout: "r",
      acceptance: "acc",
    },
    requirements: DRAFTS.map((draft) => ({
      ...draft,
      acceptanceCriteria: [...draft.acceptanceCriteria],
    })),
    workUnits: [
      {
        id: WU_ID,
        title: "Implement login",
        // A REAL mapping, computed with the same derivation the builder uses
        // — the readiness gate refuses an unmapped requirement, so a
        // degenerate empty mapping would never reach the seal at all.
        requirementIds: DRAFTS.map((draft) => computeRequirementId(intentContractId, draft)),
        dependsOn: [],
        role: "implementation",
        ownedPaths: ["packages/example/src/"],
      },
    ],
    envelopeContent: {
      ownedPaths: ["packages/example/src/"],
      commands: [],
      networkDestinations: [],
      credentialReferences: [],
      dependencies: [],
      remoteResourceAuthorizations: [],
      temporaryServices: [],
      prohibitedActions: [],
    },
    rollbackStrategy: "Revert the integration commit.",
  };
}

describe("approved requirements survive a process restart (roadmap/24 exit criterion 1)", () => {
  it("resolves every approved requirement by id, with its criteria and criteriaHash intact and its seal still verifying, from a second process", async () => {
    // ---- PROCESS 1: intake, then approval (which is what seals) ----
    const built = await (async () => {
      const journal = openJournal();
      const requirements = openRequirementsRegistry();
      const changeSets = createChangeSetsRegistry();
      const outcome = await runIntake(
        {
          journal,
          changeSets,
          workUnits: createWorkUnitsRegistry(),
          envelopes: createAuthorizationEnvelopesRegistry(),
          intentContracts: createIntentContractsRegistry(),
          requirements,
        },
        request(),
      );
      expect(outcome.status).toBe("created");
      if (outcome.status === "conflict") throw new Error("unreachable");

      // Approve through the one funnel both activation paths share, resolving
      // the records from the DURABLE registry rather than from the in-memory
      // build result — exactly as a second process would have to.
      const declared = outcome.artifacts.intentContract.requirementIds;
      const ready = await transitionChangeSetToReady({
        journal,
        changeSets,
        changeSetId: CHANGE_SET_ID,
        stageCompletions: designGateClosed(CHANGE_SET_ID),
        requirementIds: declared,
        workUnits: outcome.artifacts.workUnits,
        requirements: resolveRequirements(requirements, declared),
      });
      expect(ready.state).toBe("ready");
      return { declared, requirements: outcome.artifacts.requirements };
    })();

    expect(built.declared).toHaveLength(DRAFTS.length);

    // ---- PROCESS 2: nothing but the bytes on disk survives ----
    const reloadedRegistry = openRequirementsRegistry();
    const reloadedJournal = openJournal();
    const seal = await findLatestCriteriaSeal(reloadedJournal, CHANGE_SET_ID);
    expect(seal).toBeDefined();

    for (const id of built.declared) {
      const reloaded = reloadedRegistry.get(id);
      expect(reloaded, `requirement ${id} did not survive the restart`).toBeDefined();

      const original = built.requirements.find((requirement) => requirement.id === id)!;
      // The whole record round-trips, not merely the two fields under test.
      expect(reloaded).toStrictEqual(original);
      expect(reloaded!.acceptanceCriteria).toStrictEqual(original.acceptanceCriteria);
      expect(reloaded!.criteriaHash).toBe(original.criteriaHash);
      // Self-consistent after the round trip: the hash still describes the
      // criteria that came back, not the ones that went in.
      expect(reloaded!.criteriaHash).toBe(computeCriteriaHash(reloaded!.acceptanceCriteria));
      // And the durable record still verifies against the durable seal — the
      // point of the criterion: a restarted process can still judge.
      expect(verifyCriteriaSeal(reloaded!, seal).ok).toBe(true);
      expect(seal!.criteriaHashes[id]).toBe(original.criteriaHash);
    }
  });

  it("a requirement edited on disk after approval no longer verifies — durability is the seal's substrate, not a synonym for trust", async () => {
    const journal = openJournal();
    const requirements = openRequirementsRegistry();
    const changeSets = createChangeSetsRegistry();
    const outcome = await runIntake(
      {
        journal,
        changeSets,
        workUnits: createWorkUnitsRegistry(),
        envelopes: createAuthorizationEnvelopesRegistry(),
        intentContracts: createIntentContractsRegistry(),
        requirements,
      },
      request(),
    );
    if (outcome.status === "conflict") throw new Error("unreachable");
    const declared = outcome.artifacts.intentContract.requirementIds;
    await transitionChangeSetToReady({
      journal,
      changeSets,
      changeSetId: CHANGE_SET_ID,
      stageCompletions: designGateClosed(CHANGE_SET_ID),
      requirementIds: declared,
      workUnits: outcome.artifacts.workUnits,
      requirements: resolveRequirements(requirements, declared),
    });

    // Someone rewrites the criteria in the durable store AND recomputes the
    // record's own hash, so the record is perfectly self-consistent.
    const target = requirements.get(declared[0]!)!;
    const widened = ["Anything at all is acceptable"];
    requirements.put({
      ...target,
      acceptanceCriteria: widened,
      criteriaHash: computeCriteriaHash(widened),
    });

    const reloaded = openRequirementsRegistry().get(declared[0]!)!;
    const seal = await findLatestCriteriaSeal(openJournal(), CHANGE_SET_ID);
    const checked = verifyCriteriaSeal(reloaded, seal);
    expect(checked.ok).toBe(false);
    expect(checked.reason).toBe("approval_seal_mismatch");
  });
});
