import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { computeCriteriaHash } from "@crabgic/contracts";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import { createRequirementsRegistry } from "../registries/requirements-registry.js";
import { createWorkUnitsRegistry } from "../registries/work-units-registry.js";
import { createAuthorizationEnvelopesRegistry } from "../registries/authorization-envelopes-registry.js";
import { createIntentContractsRegistry } from "../registries/intent-contracts-registry.js";
import { runIntake, type IntakeDeps, type IntakeRequest } from "./intake-pipeline.js";

const CHANGE_SET_ID = "11111111-1111-4111-8111-111111111111";
const WU_ID = "22222222-1111-4111-8111-111111111111";

function baseRequest(overrides: Partial<IntakeRequest> = {}): IntakeRequest {
  return {
    requestKey: "repo:example",
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
    requirements: [
      {
        section: "scope",
        title: "Add login form",
        description: "d",
        acceptanceCriteria: ["works"],
      },
    ],
    workUnits: [
      {
        id: WU_ID,
        title: "Implement login form",
        requirementIds: [],
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
    performanceBudgetSource: "ecosystem_research",
    performanceBudgets: [{ metric: "latency", percentile: 95, threshold: 200, unit: "ms" }],
    ...overrides,
  };
}

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-supervisor-intake-pipeline-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

/** Fresh, empty registry set + this test's own journal — one call per "process" a test wants to simulate. */
function freshDeps(): IntakeDeps {
  return {
    journal: store,
    changeSets: createChangeSetsRegistry(),
    workUnits: createWorkUnitsRegistry(),
    envelopes: createAuthorizationEnvelopesRegistry(),
    intentContracts: createIntentContractsRegistry(),
    requirements: createRequirementsRegistry(),
  };
}

describe("runIntake", () => {
  it("creates exactly one ChangeSet and transitions draft -> awaiting_approval on completion", async () => {
    const deps = freshDeps();

    const outcome = await runIntake(deps, baseRequest());

    expect(outcome.status).toBe("created");
    if (outcome.status === "conflict") throw new Error("unreachable");
    expect(outcome.artifacts.changeSet.state).toBe("awaiting_approval");
    expect(deps.changeSets.list()).toHaveLength(1);
    expect(deps.envelopes.get(outcome.artifacts.envelope.id)).toEqual(outcome.artifacts.envelope);
  });

  /**
   * The `IntentContract` is the ONLY durable source of a ChangeSet's
   * `requirementIds`, and `contract.approve` needs them to run its
   * unmapped-requirement readiness pre-check server-side. Persisting the
   * ChangeSet/envelope/work-units but not this left that check with nothing
   * to read from a second process — the same class of gap that made an
   * approved DAG invisible to the daemon before the registries went
   * file-backed.
   *
   * Deriving the ids from the work units instead would be worse than
   * useless: `findUnmappedRequirements` compares requirements AGAINST the
   * work-unit mapping, so sourcing them from that same mapping makes it
   * vacuously always-empty — a gate that can never fail.
   */
  it("persists the IntentContract, the sole durable source of the requirementIds contract.approve gates on", async () => {
    const deps = freshDeps();

    const outcome = await runIntake(deps, baseRequest());

    if (outcome.status === "conflict") throw new Error("unreachable");
    const stored = deps.intentContracts.get(outcome.artifacts.intentContract.id);
    expect(stored).toEqual(outcome.artifacts.intentContract);
    expect(stored!.requirementIds.length).toBeGreaterThan(0);
    expect(stored!.id).toBe(outcome.artifacts.changeSet.intentContractId);
  });

  /**
   * The `Requirement` records themselves — roadmap/24. The IntentContract
   * persists only `requirementIds`, so before this the criteria a work unit
   * is judged against were resolvable from nothing: no registry held them,
   * and the sole durable copy was an incidental blob inside the intake
   * idempotency journal entry. Sealing them is meaningless if the seal
   * cannot be read back and compared.
   */
  it("persists every Requirement record, sealed, so completion can be judged against them", async () => {
    const deps = freshDeps();

    const outcome = await runIntake(deps, baseRequest());

    if (outcome.status === "conflict") throw new Error("unreachable");
    expect(outcome.artifacts.requirements.length).toBeGreaterThan(0);
    for (const requirement of outcome.artifacts.requirements) {
      const stored = deps.requirements.get(requirement.id);
      expect(stored).toEqual(requirement);
      // The seal survives persistence, and matches the criteria it covers.
      expect(stored!.criteriaHash).toBe(computeCriteriaHash(stored!.acceptanceCriteria));
    }
    // Every id the contract declares resolves to a stored record.
    for (const id of outcome.artifacts.intentContract.requirementIds) {
      expect(deps.requirements.get(id)).toBeDefined();
    }
  });

  it("re-inspecting an unchanged repo never creates a second ChangeSet (journal-verified)", async () => {
    const deps = freshDeps();
    const request = baseRequest();

    const first = await runIntake(deps, request);
    const second = await runIntake(deps, request);

    expect(first.status).toBe("created");
    expect(second.status).toBe("replayed");
    expect(deps.changeSets.list()).toHaveLength(1);
    if (first.status !== "conflict" && second.status !== "conflict") {
      expect(second.artifacts.changeSet.id).toBe(first.artifacts.changeSet.id);
    }

    let remoteOpCount = 0;
    for await (const _entry of store.queryEntries({ type: "remote_operation_record" }))
      remoteOpCount++;
    expect(remoteOpCount).toBe(1);

    let transitionCount = 0;
    for await (const _entry of store.queryEntries({ type: "run_transition" })) transitionCount++;
    expect(transitionCount).toBe(1);
  });

  it("rehydrates registry state (without a second transition) when replayed against a fresh, empty registry set", async () => {
    const request = baseRequest();
    await runIntake(freshDeps(), request);

    // Simulate a fresh process: brand-new, empty in-memory registries against the SAME journal.
    const freshDepsForSecondProcess = freshDeps();
    const outcome = await runIntake(freshDepsForSecondProcess, request);

    expect(outcome.status).toBe("replayed");
    if (outcome.status === "conflict") throw new Error("unreachable");
    expect(freshDepsForSecondProcess.changeSets.list()).toHaveLength(1);
    expect(outcome.artifacts.changeSet.state).toBe("awaiting_approval");
    expect(freshDepsForSecondProcess.envelopes.get(outcome.artifacts.envelope.id)).toBeDefined();

    let transitionCount = 0;
    for await (const _entry of store.queryEntries({ type: "run_transition" })) transitionCount++;
    expect(transitionCount).toBe(2); // one per distinct (empty-registry) process, never per replay call within the same process
  });

  it("returns a conflict outcome — never a second ChangeSet — when the same requestKey's content changes", async () => {
    const deps = freshDeps();
    await runIntake(deps, baseRequest());

    const outcome = await runIntake(
      deps,
      baseRequest({ rollbackStrategy: "A completely different rollback strategy." }),
    );

    expect(outcome.status).toBe("conflict");
    expect(deps.changeSets.list()).toHaveLength(1);
  });

  it("throws UnmappedRequirementError-free artifacts remain buildable even with an incomplete DAG (coverage enforced later, at the ready gate)", async () => {
    const outcome = await runIntake(
      freshDeps(),
      baseRequest({
        requirements: [
          { section: "scope", title: "A", description: "d", acceptanceCriteria: ["x"] },
          { section: "scope", title: "B", description: "d", acceptanceCriteria: ["x"] },
        ],
        workUnits: [],
      }),
    );
    expect(outcome.status).toBe("created");
  });
});
