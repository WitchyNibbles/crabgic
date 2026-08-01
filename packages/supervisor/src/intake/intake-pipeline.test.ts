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
import {
  runIntake,
  UnknownEcosystemError,
  type IntakeDeps,
  type IntakeRequest,
} from "./intake-pipeline.js";

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

/**
 * BUDGET PROVENANCE IS DERIVED, NOT DECLARED (ledger Gap 21).
 *
 * `IntakeRequest` used to carry `performanceBudgetSource` AND
 * `performanceBudgets` as required caller-supplied fields, copied verbatim into
 * the provisional contract — so the sourcing order roadmap/15 specifies was
 * implemented in `packages/perf` and enforced nowhere, and a caller could
 * declare `requirement_acceptance_criteria` beside budgets no criterion ever
 * produced. The repo's OWN golden fixture did exactly that.
 *
 * Intake now runs the rule itself against the requirements it just built, so a
 * declaration that disagrees with its criteria is unrepresentable rather than
 * policed — the same posture as `contract.approve` deriving the expected digest
 * server-side instead of trusting the caller.
 */
describe("runIntake — derived budget provenance", () => {
  function withRequirements(
    requirements: IntakeRequest["requirements"],
    overrides: Partial<IntakeRequest> = {},
  ): IntakeRequest {
    return baseRequest({ requirements, ...overrides });
  }

  const perfRequirement = {
    section: "performance" as const,
    title: "Login submit latency budget",
    description: "The login submit round trip stays inside its budget.",
    acceptanceCriteria: ["latency p95 <= 200ms"],
    workUnitIds: [WU_ID],
  };

  it("derives source #1 from the performance-section requirement's criteria", async () => {
    const deps = freshDeps();
    const outcome = await runIntake(deps, withRequirements([perfRequirement]));

    if (outcome.status === "conflict") throw new Error("unreachable");
    const contract = outcome.artifacts.provisionalPerformanceContract;
    expect(contract.budgetSource).toBe("requirement_acceptance_criteria");
    expect(contract.budgets).toStrictEqual([
      { metric: "latency", percentile: 95, threshold: 200, unit: "ms" },
    ]);
  });

  it("does NOT resolve source #1 from a parseable criterion on a non-performance section", async () => {
    const deps = freshDeps();
    const outcome = await runIntake(
      deps,
      withRequirements([{ ...perfRequirement, section: "scope" as const }]),
    );

    if (outcome.status === "conflict") throw new Error("unreachable");
    // Scope-section criteria are not budget sources, however parseable.
    expect(outcome.artifacts.provisionalPerformanceContract.budgetSource).not.toBe(
      "requirement_acceptance_criteria",
    );
  });

  it("falls through to the pinned ecosystem table when no performance criterion parses (source #2)", async () => {
    const deps = freshDeps();
    const outcome = await runIntake(
      deps,
      withRequirements([{ ...perfRequirement, acceptanceCriteria: ["It should feel snappy."] }], {
        ecosystem: "node",
      }),
    );

    if (outcome.status === "conflict") throw new Error("unreachable");
    const contract = outcome.artifacts.provisionalPerformanceContract;
    expect(contract.budgetSource).toBe("ecosystem_research");
    expect(contract.budgets.length).toBeGreaterThan(0);
  });

  it("yields an empty set tagged base_revision_measurement when neither source resolves (source #3)", async () => {
    const deps = freshDeps();
    const outcome = await runIntake(
      deps,
      withRequirements([{ ...perfRequirement, acceptanceCriteria: ["It should feel snappy."] }]),
    );

    if (outcome.status === "conflict") throw new Error("unreachable");
    const contract = outcome.artifacts.provisionalPerformanceContract;
    expect(contract.budgetSource).toBe("base_revision_measurement");
    expect(contract.budgets).toStrictEqual([]);
  });

  it("treats the ecosystem as request content — a different one is a conflict, never a silent second ChangeSet", async () => {
    const deps = freshDeps();
    const request = withRequirements([perfRequirement], { ecosystem: "node" });
    await runIntake(deps, request);

    const second = await runIntake(deps, { ...request, ecosystem: "python" });
    expect(second.status).toBe("conflict");
  });

  // Intake reads its request as `JSON.parse(raw) as IntakeRequest` — there is
  // no `IntakeRequestSchema`, so `ecosystem` arrives entirely unvalidated. It
  // selects a row in a pinned four-row table and does nothing else, so an
  // unknown value is a typo the author will never see: it silently degrades to
  // source #3 while looking like it picked a budget. Fail fast at the boundary.
  it.each(["java", "Node", "node ", "cobol", ""])(
    "rejects the unknown ecosystem %j rather than silently degrading to source #3",
    async (ecosystem) => {
      const deps = freshDeps();
      await expect(
        runIntake(deps, withRequirements([perfRequirement], { ecosystem })),
      ).rejects.toThrow(UnknownEcosystemError);
    },
  );

  it("names the known ecosystems in the rejection, so the fix is obvious", async () => {
    const deps = freshDeps();
    await expect(
      runIntake(deps, withRequirements([perfRequirement], { ecosystem: "java" })),
    ).rejects.toThrow(/go, node, python, rust/);
  });

  // The crash this validation closes: `ECOSYSTEM_RESEARCH_BUDGETS` was a plain
  // object literal, so `TABLE["constructor"]` answered with `Object` (arity 1,
  // passing the `.length > 0` liveness check) and spreading it threw
  // `TypeError: researched is not iterable` out of `@crabgic/contracts`. Prose
  // criteria are what reach source #2, so this is the shape that crashed: a
  // stdin body whose only unusual field is `"ecosystem": "constructor"`.
  it.each(["constructor", "hasOwnProperty", "__proto__", "toString"])(
    "rejects the inherited Object.prototype member %j as an ecosystem, never crashing",
    async (member) => {
      const deps = freshDeps();
      const attempt = runIntake(
        deps,
        withRequirements([{ ...perfRequirement, acceptanceCriteria: ["It should feel snappy."] }], {
          ecosystem: member,
        }),
      );
      await expect(attempt).rejects.toThrow(UnknownEcosystemError);
      await expect(attempt).rejects.not.toThrow(TypeError);
    },
  );

  // Validation is a boundary check, not a lookup guard: it fires even when a
  // resolving source #1 means the ecosystem would never have been consulted.
  // Otherwise the same typo is an error or a silent no-op depending on whether
  // some unrelated criterion happened to parse.
  it("rejects an unknown ecosystem even when source #1 resolves and the table is never consulted", async () => {
    const deps = freshDeps();
    await expect(
      runIntake(deps, withRequirements([perfRequirement], { ecosystem: "constructor" })),
    ).rejects.toThrow(UnknownEcosystemError);
  });

  it("a rejected ecosystem writes no idempotency record, so a corrected retry is not a conflict", async () => {
    const deps = freshDeps();
    await expect(
      runIntake(deps, withRequirements([perfRequirement], { ecosystem: "constructor" })),
    ).rejects.toThrow(UnknownEcosystemError);

    const retry = await runIntake(deps, withRequirements([perfRequirement], { ecosystem: "node" }));
    expect(retry.status).toBe("created");
  });

  it("still accepts every ecosystem the pinned table actually has a row for", async () => {
    for (const ecosystem of ["node", "python", "go", "rust"]) {
      const deps = freshDeps();
      const outcome = await runIntake(
        deps,
        withRequirements([{ ...perfRequirement, acceptanceCriteria: ["It should feel snappy."] }], {
          ecosystem,
          requestKey: `repo:${ecosystem}`,
        }),
      );
      if (outcome.status === "conflict") throw new Error("unreachable");
      expect(outcome.artifacts.provisionalPerformanceContract.budgetSource).toBe(
        "ecosystem_research",
      );
    }
  });

  it("anchors the DERIVED provisional contract in the intake idempotency record", async () => {
    const deps = freshDeps();
    const outcome = await runIntake(deps, withRequirements([perfRequirement]));
    if (outcome.status === "conflict") throw new Error("unreachable");

    let anchored = false;
    for await (const entry of store.queryEntries({ type: "remote_operation_record" })) {
      if (entry.type !== "remote_operation_record") continue;
      const applied = entry.payload.appliedRevision;
      if (applied !== undefined && applied.includes("requirement_acceptance_criteria")) {
        anchored = true;
      }
    }
    // 15's `findJournalAnchoredBudgetSnapshot` reads this entry; the provenance
    // it pins must be the derived one, not a caller's claim.
    expect(anchored).toBe(true);
  });
});
