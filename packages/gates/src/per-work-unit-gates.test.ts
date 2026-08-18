import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGateRegistry } from "./registry.js";
import { allGatesPassed, fireFinalCandidateVerification } from "./final-candidate.js";
import type { GateVerdict } from "./types.js";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";

/**
 * ⚠️ PER-WORK-UNIT GATES, AND WHY THE EXCLUSION IS BY MARKER RATHER THAN BY TAG.
 *
 * Some checks are per-work-unit by construction. The TDD gate is the first: the
 * ordering boundary it reads is a `work_unit_transition`, and a
 * `final_verifying` firing carries no `workUnitId` by design
 * (`./types.ts`: "absent at `final_verifying` — that firing verifies the
 * integrated candidate as a whole, with no single owning `WorkUnit`"). Firing
 * such a gate there means failing closed on every run.
 *
 * The obvious fix — have `fireFinalCandidateVerification` skip the `tdd` TAG —
 * was measured and rejected: `./final-candidate.test.ts:112` registers its own
 * stub under `tdd` and asserts the full tag set fires, and that test is cited by
 * phase 14's exit criterion 8, which is closed. A tag exclusion would redden a
 * closed criterion's own evidence.
 *
 * So the exclusion is a property of the REGISTRATION, not of the tag. A gate
 * that declares itself per-work-unit is skipped by `fireAll`; every gate
 * registered the ordinary way — including that stub — still fires. The
 * criterion keeps its meaning ("never trusts a cached per-work-unit result",
 * and no subset of the gates that CAN judge the integrated candidate is
 * skipped) and gains an honest boundary.
 */

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

function pass(): GateVerdict {
  return {
    passed: true,
    command: "stub",
    exitStatus: 0,
    toolchainFingerprint: "stub@1",
    artifactDigests: [],
    detail: "stub",
  };
}

const finalContext = () => ({
  stage: "final_verifying" as const,
  changeSetId: "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
  objectId: "integrated-obj",
  journal: tj.store,
});

describe("per-work-unit gates are excluded from final-candidate verification", () => {
  it("fireAll SKIPS a gate registered as per-work-unit", async () => {
    let perUnitFired = false;
    const marked = createGateRegistry();
    marked.register(
      "tdd",
      "per-unit",
      async () => {
        perUnitFired = true;
        return pass();
      },
      { perWorkUnit: true },
    );
    marked.register("coverage", "ordinary", async () => pass());

    const results = await fireFinalCandidateVerification(marked, finalContext());

    expect(perUnitFired, "a per-work-unit gate fired at final_verifying").toBe(false);
    expect(results.map((r) => r.name)).toStrictEqual(["ordinary"]);
    expect(allGatesPassed(results)).toBe(true);
  });

  /**
   * ⚠️ The arm that keeps the closed criterion intact. An ORDINARY registration
   * under the very same `tdd` tag still fires — which is exactly what
   * `final-candidate.test.ts` does, and why the exclusion could not be a tag
   * exclusion.
   */
  it("fireAll still fires an ORDINARY gate registered under the same tag", async () => {
    const registry = createGateRegistry();
    registry.register("tdd", "ordinary-tdd", async () => pass());

    const results = await fireFinalCandidateVerification(registry, finalContext());

    expect(results.map((r) => r.name)).toStrictEqual(["ordinary-tdd"]);
  });

  /**
   * `fireByTag` is the per-unit firing path, so it must NOT apply the exclusion.
   * A marker that suppressed the gate everywhere would leave it registered and
   * never fired — the declared-but-unwired shape this work exists to end.
   */
  it("fireByTag DOES fire a per-work-unit gate — that is its firing path", async () => {
    const registry = createGateRegistry();
    let fired = false;
    registry.register(
      "tdd",
      "per-unit",
      async () => {
        fired = true;
        return pass();
      },
      { perWorkUnit: true },
    );

    const results = await registry.fireByTag(
      "tdd",
      { ...finalContext(), stage: "verifying", workUnitId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" },
      { requireAtLeastOne: true },
    );

    expect(fired).toBe(true);
    expect(results).toHaveLength(1);
  });

  /**
   * A registry holding ONLY per-work-unit gates has nothing that can judge the
   * integrated candidate, and `fireAll`'s own `[].every(...) === true` would
   * report that as a pass. It must fail closed, exactly as an empty registry
   * does — the exclusion must not become a new way to verify nothing.
   */
  it("FAILS CLOSED when every registered gate is per-work-unit", async () => {
    const registry = createGateRegistry();
    registry.register("tdd", "per-unit", async () => pass(), { perWorkUnit: true });

    await expect(fireFinalCandidateVerification(registry, finalContext())).rejects.toThrow(
      /zero registered handlers/i,
    );
  });

  it("reports the marker on `list()`, so a composition root can audit what will fire where", () => {
    const registry = createGateRegistry();
    registry.register("tdd", "per-unit", async () => pass(), { perWorkUnit: true });
    registry.register("coverage", "ordinary", async () => pass());

    expect(registry.list("tdd")[0]?.perWorkUnit).toBe(true);
    expect(registry.list("coverage")[0]?.perWorkUnit).toBe(false);
  });
});

/**
 * `firePerWorkUnit` is the EXACT complement of `fireAll`. Stated as its own
 * suite because the two methods together are the claim that every registered
 * gate fires exactly once per candidate — a gate that fell between them would
 * be registered, listed, and never run, which is the shape this whole change
 * set exists to end.
 */
describe("firePerWorkUnit — the complement of fireAll", () => {
  it("fires ONLY the per-work-unit gates, and fireAll fires only the rest", async () => {
    const registry = createGateRegistry();
    registry.register("tdd", "per-unit", async () => pass(), { perWorkUnit: true });
    registry.register("coverage", "ordinary", async () => pass());

    const perUnit = await registry.firePerWorkUnit({
      ...finalContext(),
      stage: "verifying",
      workUnitId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    });
    const rest = await fireFinalCandidateVerification(registry, finalContext());

    expect(perUnit.map((r) => r.name)).toStrictEqual(["per-unit"]);
    expect(rest.map((r) => r.name)).toStrictEqual(["ordinary"]);
    // The partition is exhaustive: nothing registered is missed by both.
    expect([...perUnit, ...rest].map((r) => r.name).sort()).toStrictEqual(
      registry
        .list()
        .map((g) => g.name)
        .sort(),
    );
  });

  it("FAILS CLOSED under requireAtLeastOne when no per-work-unit gate is registered", async () => {
    const registry = createGateRegistry();
    registry.register("coverage", "ordinary", async () => pass());

    await expect(
      registry.firePerWorkUnit(
        {
          ...finalContext(),
          stage: "verifying",
          workUnitId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
        },
        { requireAtLeastOne: true },
      ),
    ).rejects.toThrow(/zero registered handlers/i);
  });
});
