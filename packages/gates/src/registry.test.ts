import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import { createGateRegistry, type GateRegistry } from "./registry.js";
import type { GateContext, GateVerdict } from "./types.js";

function stubVerdict(passed: boolean, detail: string): GateVerdict {
  return {
    passed,
    command: "stub-gate",
    exitStatus: passed ? 0 : 1,
    toolchainFingerprint: "stub@1.0.0",
    artifactDigests: [],
    detail,
  };
}

let tj: TestJournal;
let baseContext: Omit<GateContext, "objectId" | "stage">;

beforeEach(async () => {
  tj = await createTestJournal();
  baseContext = { changeSetId: randomUUID(), journal: tj.store };
});

afterEach(async () => {
  await tj.cleanup();
});

describe("createGateRegistry — work item 1: a stub gate registers and fires before any real check exists", () => {
  it("registers a stub handler under a tag and fires it via fireByTag, emitting one EvidenceRecord", async () => {
    const registry: GateRegistry = createGateRegistry();
    registry.register("tdd", "stub-tdd", async () => stubVerdict(true, "stub always passes"));

    const context: GateContext = { ...baseContext, stage: "verifying", objectId: "obj-1" };
    const results = await registry.fireByTag("tdd", context);

    expect(results).toHaveLength(1);
    expect(results[0]?.tag).toBe("tdd");
    expect(results[0]?.name).toBe("stub-tdd");
    expect(results[0]?.verdict.passed).toBe(true);
    expect(results[0]?.evidence.gateTag).toBe("tdd");
    expect(results[0]?.evidence.objectId).toBe("obj-1");
    expect(results[0]?.evidence.changeSetId).toBe(baseContext.changeSetId);

    const journaled: unknown[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      journaled.push(entry);
    }
    expect(journaled).toHaveLength(1);
  });

  it("list() returns every registered gate, optionally filtered by tag", () => {
    const registry = createGateRegistry();
    registry.register("tdd", "a", async () => stubVerdict(true, "a"));
    registry.register("coverage", "b", async () => stubVerdict(true, "b"));
    registry.register("tdd", "c", async () => stubVerdict(true, "c"));

    expect(registry.list("tdd").map((g) => g.name)).toEqual(["a", "c"]);
    expect(registry.list("coverage").map((g) => g.name)).toEqual(["b"]);
    expect(
      registry
        .list()
        .map((g) => g.name)
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });

  it("firing a tag with zero registered handlers is a no-op by default", async () => {
    const registry = createGateRegistry();
    const context: GateContext = { ...baseContext, stage: "verifying", objectId: "obj-1" };
    const results = await registry.fireByTag("security", context);
    expect(results).toEqual([]);
  });

  it("requireAtLeastOne throws NoGatesRegisteredError when nothing is registered under the tag", async () => {
    const registry = createGateRegistry();
    const context: GateContext = { ...baseContext, stage: "verifying", objectId: "obj-1" };
    await expect(
      registry.fireByTag("security", context, { requireAtLeastOne: true }),
    ).rejects.toThrow(/zero registered handlers/i);
  });

  it("fireAll's requireAtLeastOne throws NoGatesRegisteredError when the registry is completely empty", async () => {
    const registry = createGateRegistry();
    const context: GateContext = { ...baseContext, stage: "final_verifying", objectId: "obj-1" };
    await expect(registry.fireAll(context, { requireAtLeastOne: true })).rejects.toThrow(
      /zero registered handlers/i,
    );
  });

  it("fireAll fires every registered handler across every tag", async () => {
    const registry = createGateRegistry();
    registry.register("tdd", "a", async () => stubVerdict(true, "a"));
    registry.register("coverage", "b", async () => stubVerdict(true, "b"));
    registry.register("security", "c", async () => stubVerdict(false, "c blocks"));

    const context: GateContext = { ...baseContext, stage: "final_verifying", objectId: "obj-2" };
    const results = await registry.fireAll(context);
    expect(results.map((r) => r.name).sort()).toEqual(["a", "b", "c"]);
    expect(results.every((r) => r.evidence.objectId === "obj-2")).toBe(true);
  });

  it("multiple handlers may register under the same tag (e.g. 'security' shared between 14's own scanners and 21's connector fixtures) and all fire", async () => {
    const registry = createGateRegistry();
    registry.register("security", "semgrep", async () => stubVerdict(true, "clean"));
    registry.register("security", "connector-fixture-21", async () => stubVerdict(true, "clean"));

    const context: GateContext = { ...baseContext, stage: "verifying", objectId: "obj-3" };
    const results = await registry.fireByTag("security", context);
    expect(results.map((r) => r.name)).toEqual(["semgrep", "connector-fixture-21"]);
  });
});

describe("external extensibility — work item 6 / registry-extensibility conformance test", () => {
  it("a stub EXTERNAL gate registers and fires at final_verifying with zero code change inside this package's own modules", async () => {
    const registry = createGateRegistry();

    // Simulates a downstream phase (15's performance gate, 21's connector
    // security fixtures) registering against the SAME public API this
    // package's own gates use — no internal registry code is touched.
    function registerExternalGate(target: GateRegistry): void {
      target.register("performance", "15-external-perf-gate", async () =>
        stubVerdict(true, "external gate ran"),
      );
    }
    registerExternalGate(registry);

    const context: GateContext = {
      ...baseContext,
      stage: "final_verifying",
      objectId: "integrated-obj",
    };
    const results = await registry.fireByTag("performance", context);
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("15-external-perf-gate");
    expect(results[0]?.evidence.gateTag).toBe("performance");

    // Also reachable via fireAll (the final-candidate re-verification path).
    const allResults = await registry.fireAll({ ...context, objectId: "integrated-obj-2" });
    expect(allResults.some((r) => r.name === "15-external-perf-gate")).toBe(true);
  });
});
