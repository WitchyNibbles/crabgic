import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdempotencyRegistry } from "@crabgic/journal";
import {
  applySideEffectExactlyOnce,
  applySideEffectNaive,
  countApplications,
  createSideEffectSink,
} from "./sideEffectSink.js";
import { createTestJournal, type TestJournal } from "./testJournal.js";

let journal: TestJournal;

beforeEach(async () => {
  journal = await createTestJournal();
});

afterEach(async () => {
  await journal.cleanup();
});

describe("applySideEffectNaive", () => {
  it("applies every call unconditionally — calling it twice for the same operationId duplicates the side effect", () => {
    const sink = createSideEffectSink();
    applySideEffectNaive(sink, "op-1");
    applySideEffectNaive(sink, "op-1");
    expect(countApplications(sink, "op-1")).toBe(2);
  });
});

describe("applySideEffectExactlyOnce", () => {
  it("applies the side effect exactly once for repeated calls with the same (operationId, contentHash)", async () => {
    const sink = createSideEffectSink();
    const registry = new IdempotencyRegistry(journal.store);

    const first = await applySideEffectExactlyOnce(sink, registry, "op-2", "hash-a");
    const second = await applySideEffectExactlyOnce(sink, registry, "op-2", "hash-a");

    expect(first).toBe("applied");
    expect(second).toBe("replayed");
    expect(countApplications(sink, "op-2")).toBe(1);
  });

  it("survives a brand-new IdempotencyRegistry instance over the same journal (restart-safe)", async () => {
    const sink = createSideEffectSink();
    const registry1 = new IdempotencyRegistry(journal.store);
    await applySideEffectExactlyOnce(sink, registry1, "op-3", "hash-b");

    // Simulated restart: a fresh registry instance, same on-disk journal.
    const registry2 = new IdempotencyRegistry(journal.store);
    const outcome = await applySideEffectExactlyOnce(sink, registry2, "op-3", "hash-b");

    expect(outcome).toBe("replayed");
    expect(countApplications(sink, "op-3")).toBe(1);
  });

  it("a genuinely different contentHash for the same operationId is a conflict, never a silent second apply", async () => {
    const sink = createSideEffectSink();
    const registry = new IdempotencyRegistry(journal.store);
    await applySideEffectExactlyOnce(sink, registry, "op-4", "hash-c");

    const outcome = await registry.checkOrRecord("op-4", "hash-d", () => {
      // A conflicting call's compute() must never run.
      sink.applications.push("op-4");
      return sink.applications.length;
    });

    expect(outcome.status).toBe("conflict");
    // compute() never ran for the conflicting hash — still exactly one application.
    expect(countApplications(sink, "op-4")).toBe(1);
  });
});

describe("countApplications", () => {
  it("counts only entries matching the given operationId", () => {
    const sink = createSideEffectSink();
    applySideEffectNaive(sink, "a");
    applySideEffectNaive(sink, "b");
    applySideEffectNaive(sink, "a");
    expect(countApplications(sink, "a")).toBe(2);
    expect(countApplications(sink, "b")).toBe(1);
    expect(countApplications(sink, "c")).toBe(0);
  });
});
