import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import { createGateRegistry } from "./registry.js";
import { createCoverageGate } from "./coverage-gate.js";
import type { GateContext } from "./types.js";

let tj: TestJournal;
let baseContext: Omit<GateContext, "objectId" | "stage">;

const PROJECT_ID = "project-under-test";

beforeEach(async () => {
  tj = await createTestJournal();
  baseContext = { changeSetId: randomUUID(), journal: tj.store };
});

afterEach(async () => {
  await tj.cleanup();
});

describe("coverage gate", () => {
  it("passes a greenfield project at/above the 80% minimum on both axes", async () => {
    const registry = createGateRegistry();
    registry.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: PROJECT_ID,
        summary: { linePct: 85, branchPct: 81, toolchain: "istanbul" },
      }),
    );
    const [result] = await registry.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.passed).toBe(true);
  });

  it("fails a greenfield project below the 80% minimum", async () => {
    const registry = createGateRegistry();
    registry.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: PROJECT_ID,
        summary: { linePct: 70, branchPct: 90, toolchain: "istanbul" },
      }),
    );
    const [result] = await registry.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.passed).toBe(false);
    expect(result?.verdict.detail).toMatch(/greenfield|effective/i);
  });

  it("MINOR-2 (adversarial-validation round): a project that fails greenfield once must NOT then be able to pass in the 50-79% band indefinitely", async () => {
    // Run 1: 50% — correctly fails the greenfield 80% minimum. But this
    // observation is STILL RECORDED (ratchet history is append-only), so
    // the raw ratchet floor becomes 50 afterward.
    const registryFirst = createGateRegistry();
    registryFirst.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: PROJECT_ID,
        summary: { linePct: 50, branchPct: 50, toolchain: "istanbul" },
      }),
    );
    const [first] = await registryFirst.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj-1",
    });
    expect(first?.verdict.passed).toBe(false);

    // Run 2: 60% — NOT a regression relative to the raw 50% floor, so a
    // ratchet-only check would wrongly PASS here, despite still being well
    // below the 80% greenfield minimum this project has never yet met.
    const registrySecond = createGateRegistry();
    registrySecond.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: PROJECT_ID,
        summary: { linePct: 60, branchPct: 60, toolchain: "istanbul" },
      }),
    );
    const [second] = await registrySecond.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj-2",
    });
    expect(second?.verdict.passed).toBe(false);

    // Run 3: once the project genuinely reaches >=80%, ordinary ratchet
    // behavior resumes (the effective-floor clamp becomes a no-op).
    const registryThird = createGateRegistry();
    registryThird.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: PROJECT_ID,
        summary: { linePct: 85, branchPct: 85, toolchain: "istanbul" },
      }),
    );
    const [third] = await registryThird.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj-3",
    });
    expect(third?.verdict.passed).toBe(true);
  });

  it("ratchet-regression fixture: a recorded floor of 82% then a new run of 79% BLOCKS", async () => {
    const registryFirst = createGateRegistry();
    registryFirst.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: PROJECT_ID,
        summary: { linePct: 82, branchPct: 82, toolchain: "istanbul" },
      }),
    );
    const [first] = await registryFirst.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj-1",
    });
    expect(first?.verdict.passed).toBe(true);

    const registrySecond = createGateRegistry();
    registrySecond.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: PROJECT_ID,
        summary: { linePct: 79, branchPct: 85, toolchain: "istanbul" },
      }),
    );
    const [second] = await registrySecond.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj-2",
    });
    expect(second?.verdict.passed).toBe(false);
    expect(second?.verdict.detail).toMatch(/regressed/i);
  });

  it("MINOR-3 (adversarial-validation round): two different projects sharing one journal never contaminate each other's coverage gate outcome", async () => {
    const registryProjectA = createGateRegistry();
    registryProjectA.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: "project-a",
        summary: { linePct: 95, branchPct: 95, toolchain: "istanbul" },
      }),
    );
    const [projectAResult] = await registryProjectA.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj-a",
    });
    expect(projectAResult?.verdict.passed).toBe(true);

    // Project B's first-ever run, on the SAME shared journal, is well below
    // project A's floor but still >= the 80% greenfield minimum — it must
    // pass on its own merits, never be treated as a regression against
    // project A's unrelated 95% floor.
    const registryProjectB = createGateRegistry();
    registryProjectB.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: "project-b",
        summary: { linePct: 82, branchPct: 82, toolchain: "istanbul" },
      }),
    );
    const [projectBResult] = await registryProjectB.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj-b",
    });
    expect(projectBResult?.verdict.passed).toBe(true);
  });
});
