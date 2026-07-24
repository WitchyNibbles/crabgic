import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import { createGateRegistry } from "./registry.js";
import { createFlakeGate } from "./flake-gate.js";
import { quarantineTest } from "./flake/quarantine-registry.js";
import type { GateContext } from "./types.js";

let tj: TestJournal;
let baseContext: Omit<GateContext, "objectId" | "stage">;

beforeEach(async () => {
  tj = await createTestJournal();
  baseContext = { changeSetId: randomUUID(), journal: tj.store };
});

afterEach(async () => {
  await tj.cleanup();
});

describe("flake gate — failing-first: a scripted flaky-then-passing fixture is marked unstable, never silently green", () => {
  it("a clean first-attempt pass is green and NOT unstable", async () => {
    const registry = createGateRegistry();
    registry.register(
      "flake",
      "flake",
      createFlakeGate({ testIdentifier: "suite/a.test", initialOutcome: "passed" }),
    );
    const [result] = await registry.fireByTag("flake", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.passed).toBe(true);
    expect(result?.verdict.unstable).toBeUndefined();
  });

  it("a rerun-then-pass result is marked unstable AND blocks when not quarantined — never silently green", async () => {
    const registry = createGateRegistry();
    registry.register(
      "flake",
      "flake",
      createFlakeGate({
        testIdentifier: "suite/flaky.test",
        initialOutcome: "failed",
        rerunOutcome: "passed",
      }),
    );
    const [result] = await registry.fireByTag("flake", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.unstable).toBe(true);
    expect(result?.verdict.passed).toBe(false);
  });

  it("a rerun-then-pass result is marked unstable but ALLOWED THROUGH when an active quarantine exists", async () => {
    await quarantineTest(tj.store, {
      testIdentifier: "suite/flaky.test",
      reason: "known flaky, tracked",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    const registry = createGateRegistry();
    registry.register(
      "flake",
      "flake",
      createFlakeGate({
        testIdentifier: "suite/flaky.test",
        initialOutcome: "failed",
        rerunOutcome: "passed",
      }),
    );
    const [result] = await registry.fireByTag("flake", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    expect(result?.verdict.unstable).toBe(true);
    expect(result?.verdict.passed).toBe(true);
  });

  it("an EXPIRED quarantine reverts to blocking even for a rerun-then-pass result", async () => {
    await quarantineTest(tj.store, {
      testIdentifier: "suite/flaky.test",
      reason: "known flaky, tracked",
      expiresAt: "2020-01-01T00:00:00Z",
    });
    const registry = createGateRegistry();
    registry.register(
      "flake",
      "flake",
      createFlakeGate({
        testIdentifier: "suite/flaky.test",
        initialOutcome: "failed",
        rerunOutcome: "passed",
      }),
    );
    const [result] = await registry.fireByTag("flake", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    expect(result?.verdict.passed).toBe(false);
  });

  it("a genuine failure (failed, failed again on rerun) blocks and is NOT marked unstable", async () => {
    const registry = createGateRegistry();
    registry.register(
      "flake",
      "flake",
      createFlakeGate({
        testIdentifier: "suite/broken.test",
        initialOutcome: "failed",
        rerunOutcome: "failed",
      }),
    );
    const [result] = await registry.fireByTag("flake", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.passed).toBe(false);
    expect(result?.verdict.unstable).toBeUndefined();
  });

  it("a failure with no rerun evidence at all blocks", async () => {
    const registry = createGateRegistry();
    registry.register(
      "flake",
      "flake",
      createFlakeGate({ testIdentifier: "suite/broken2.test", initialOutcome: "failed" }),
    );
    const [result] = await registry.fireByTag("flake", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.passed).toBe(false);
  });
});
