import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createJournalStore,
  journalAcceptanceEvaluation,
  type JournalStore,
} from "@crabgic/journal";
import type { AcceptanceEvaluationRecord, Requirement } from "@crabgic/contracts";
import { buildRequirement } from "@crabgic/testkit";
import { createGateRegistry } from "./registry.js";
import {
  ACCEPTANCE_EVALUATED_GATE_NAME,
  registerAcceptanceEvaluatedGate,
} from "./acceptance-evaluated-gate.js";
import type { GateContext } from "./types.js";

const CHANGE_SET = "11111111-1111-4111-8111-111111111111";
const OTHER_CHANGE_SET = "22222222-2222-4222-8222-222222222222";
const UNIT = "33333333-3333-4333-8333-333333333333";
const OBJECT_ID = "0123456789abcdef0123456789abcdef01234567";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-gates-acceptance-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function observation(
  overrides: Partial<AcceptanceEvaluationRecord> = {},
): AcceptanceEvaluationRecord {
  return {
    schemaVersion: 1,
    changeSetId: CHANGE_SET,
    workUnitId: UNIT,
    sessionId: "44444444-4444-4444-8444-444444444444",
    requirementIds: [],
    invocations: [{ prefix: "npm run test", invocations: 1, cleanExits: 1 }],
    observedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  };
}

/** Fires the gate through the REGISTRY, never by calling a handler directly — the registry is what production uses. */
async function fire(requirements: readonly Requirement[]): Promise<{
  readonly passed: boolean;
  readonly detail: string;
}> {
  const registry = createGateRegistry();
  registerAcceptanceEvaluatedGate(registry, { requirements: () => requirements });
  const context: GateContext = {
    stage: "final_verifying",
    changeSetId: CHANGE_SET,
    objectId: OBJECT_ID,
    journal: store,
  };
  const results = await registry.fireByTag("acceptance", context);
  const result = results.find((entry) => entry.name === ACCEPTANCE_EVALUATED_GATE_NAME);
  if (result === undefined) throw new Error("the gate did not fire");
  return { passed: result.verdict.passed, detail: result.verdict.detail };
}

describe("the acceptance-evaluated gate (owner ruling R5)", () => {
  /**
   * The POSITIVE CONTROL, and the test that makes every refusal below mean
   * something. Without it, all of them would pass equally well for a gate that
   * can never be satisfied at all.
   */
  it("passes when a granted acceptance-class command ran clean for every requirement", async () => {
    const requirement = buildRequirement();
    await journalAcceptanceEvaluation(store, observation({ requirementIds: [requirement.id] }));

    const verdict = await fire([requirement]);
    expect(verdict.passed).toBe(true);
  });

  /**
   * Run `04a0bf70`: nothing ran, the worker said `{"summary":"test"}`, the run
   * published. This is the measured failure the whole ruling exists for.
   */
  it("refuses when no attempt recorded anything, and names the criteria that went unevaluated", async () => {
    const requirement = buildRequirement();
    const verdict = await fire([requirement]);

    expect(verdict.passed).toBe(false);
    const detail: unknown = JSON.parse(verdict.detail);
    expect(detail).toMatchObject({
      unevaluated: [
        {
          requirementId: requirement.id,
          title: requirement.title,
          acceptanceCriteria: requirement.acceptanceCriteria,
        },
      ],
      observed: ["no attempt recorded what it ran for this change set"],
      satisfiedBy: ["npm run test"],
    });
  });

  /**
   * Run `bc167a3a`: 29 commands executed, `npm run build` clean, the suite never
   * ran, published anyway. A gate that accepted "some granted command worked"
   * would pass this run, which is exactly the guarantee R5 refuses to keep.
   */
  it("refuses a run whose only clean command was the build, and says what would satisfy it", async () => {
    const requirement = buildRequirement();
    await journalAcceptanceEvaluation(
      store,
      observation({
        requirementIds: [requirement.id],
        invocations: [
          { prefix: "npm run build", invocations: 1, cleanExits: 1 },
          { prefix: "npm run test", invocations: 3, cleanExits: 0 },
        ],
      }),
    );

    const verdict = await fire([requirement]);
    expect(verdict.passed).toBe(false);
    const detail = JSON.parse(verdict.detail) as {
      readonly observed: readonly string[];
      readonly satisfiedBy: readonly string[];
    };
    // The actionable half: an operator can tell "the command path is broken"
    // from "the worker never tried".
    expect(detail.observed[0]).toContain("npm run test (acceptance) invoked 3x, 0 clean");
    expect(detail.observed[0]).toContain("npm run build (integrity) invoked 1x, 1 clean");
    expect(detail.satisfiedBy).toStrictEqual(["npm run test"]);
  });

  /**
   * ⚠️ THE VACUITY REFUSAL. "Every requirement was evaluated" is a universal
   * quantifier, and over an empty set it is true for free. Without this branch a
   * change set could satisfy the strongest acceptance gate in the system by
   * declaring nothing to satisfy — and it is reachable, because
   * `transitionChangeSetToReady` refuses an UNMAPPED requirement and never
   * refuses a change set that declares none.
   */
  it("refuses a change set that declares no acceptance criteria at all", async () => {
    await journalAcceptanceEvaluation(store, observation());
    const verdict = await fire([]);

    expect(verdict.passed).toBe(false);
    expect(JSON.parse(verdict.detail)).toMatchObject({
      refusal: expect.stringContaining("declares no acceptance criteria at all") as unknown,
    });
  });

  /** Otherwise one run's verification would open every later run's publish gate. */
  it("refuses when the only clean evaluation belongs to a different change set", async () => {
    const requirement = buildRequirement();
    await journalAcceptanceEvaluation(
      store,
      observation({ changeSetId: OTHER_CHANGE_SET, requirementIds: [requirement.id] }),
    );

    expect((await fire([requirement])).passed).toBe(false);
  });

  it("refuses when the clean evaluation covered a different requirement of the same change set", async () => {
    // Distinct ids explicitly: `buildRequirement`'s fixture context restarts
    // per call, so two bare calls produce the SAME id and this test would pass
    // against a gate that ignores `requirementIds` entirely.
    const covered = buildRequirement({ id: "55555555-5555-4555-8555-555555555555" });
    const uncovered = buildRequirement({ id: "66666666-6666-4666-8666-666666666666" });
    await journalAcceptanceEvaluation(store, observation({ requirementIds: [covered.id] }));

    const verdict = await fire([covered, uncovered]);
    expect(verdict.passed).toBe(false);
    const detail = JSON.parse(verdict.detail) as {
      readonly unevaluated: readonly { readonly requirementId: string }[];
    };
    // Names ONLY the uncovered one — a refusal that listed both would be as
    // unactionable as a bare one.
    expect(detail.unevaluated.map((entry) => entry.requirementId)).toStrictEqual([uncovered.id]);
  });

  /**
   * A refusal that leaves no record is a refusal nobody can read back later, so
   * the gate returns a blocking VERDICT rather than throwing — the same choice
   * the seal gate makes.
   */
  it("journals the refusal as evidence rather than throwing", async () => {
    await fire([buildRequirement()]);

    const evidence: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "evidence_pointer" })) {
      evidence.push(entry);
    }
    expect(evidence.length).toBeGreaterThan(0);
  });
});
