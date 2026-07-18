import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createJournalStore, type JournalStore } from "./store/journal-store.js";
import { assertRemoteOperationRecordEntry, IdempotencyRegistry } from "./idempotency.js";
import type { JournalEntry } from "./codec/journal-entry.js";

const dirsToClean: string[] = [];

function freshStore(): JournalStore {
  const journalDir = mkdtempSync(join(tmpdir(), "eo-journal-idempotency-"));
  dirsToClean.push(journalDir);
  return createJournalStore({ journalDir });
}

afterEach(() => {
  while (dirsToClean.length > 0) {
    rmSync(dirsToClean.pop()!, { recursive: true, force: true });
  }
});

describe("IdempotencyRegistry.checkOrRecord — basic recording", () => {
  it("a brand-new (operationId, contentHash) pair calls compute() and records the result", async () => {
    const registry = new IdempotencyRegistry(freshStore());
    const compute = vi.fn(async () => ({ ok: true, value: 42 }));

    const outcome = await registry.checkOrRecord("op-1", "hash-1", compute);

    expect(outcome.status).toBe("recorded");
    expect(outcome.result).toEqual({ ok: true, value: 42 });
    expect(compute).toHaveBeenCalledTimes(1);
  });
});

describe("IdempotencyRegistry.checkOrRecord — replay semantics (roadmap/04 work item 5)", () => {
  it("the SAME (operationId, contentHash) replays a byte-identical result and does NOT re-execute compute", async () => {
    const registry = new IdempotencyRegistry(freshStore());
    const compute = vi.fn(async () => ({ ok: true, value: "first-and-only-computation" }));

    const first = await registry.checkOrRecord("op-replay", "hash-a", compute);
    const second = await registry.checkOrRecord("op-replay", "hash-a", compute);

    expect(first.status).toBe("recorded");
    expect(second.status).toBe("replayed");
    expect(second.result).toEqual(first.result);
    // The core replay invariant this work item's RED capture exercises:
    // compute must be called exactly ONCE across both calls, never twice.
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("replay survives a brand-new IdempotencyRegistry instance against the same journal (genuinely journal-backed, not just an in-memory cache)", async () => {
    const store = freshStore();
    const firstRegistry = new IdempotencyRegistry(store);
    await firstRegistry.checkOrRecord("op-restart", "hash-x", () => ({ value: "durable" }));

    const secondRegistry = new IdempotencyRegistry(store);
    const compute = vi.fn(() => ({ value: "should-not-run" }));
    const outcome = await secondRegistry.checkOrRecord("op-restart", "hash-x", compute);

    expect(outcome.status).toBe("replayed");
    expect(outcome.result).toEqual({ value: "durable" });
    expect(compute).not.toHaveBeenCalled();
  });

  it("persists a remote_operation_record journal entry keyed on (operationId, contentHash)", async () => {
    const store = freshStore();
    const registry = new IdempotencyRegistry(store);
    await registry.checkOrRecord("op-journal-check", "hash-journal", () => ({ n: 1 }));

    const entries = [];
    for await (const entry of store.queryEntries({ type: "remote_operation_record" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("remote_operation_record");
    if (entries[0]?.type === "remote_operation_record") {
      expect(entries[0].payload.operationId).toBe("op-journal-check");
      expect(entries[0].payload.contentHash).toBe("hash-journal");
      expect(entries[0].payload.status).toBe("recorded");
    }
  });
});

describe("VALIDATION ROUND (2026-07-18) — MINOR 3 regression: the RECORDED call's result must already be JSON-round-tripped, byte-identical to what replay later returns", () => {
  it("a non-JSON-safe compute() result (Date, NaN, undefined member) is coerced identically on the FIRST (recorded) call and every later (replayed) call", async () => {
    const store = freshStore();
    const registry = new IdempotencyRegistry(store);
    const input = {
      when: new Date("2026-01-01T00:00:00.000Z"),
      n: Number.NaN,
      missing: undefined,
      kept: 1,
    };

    const first = await registry.checkOrRecord("op-roundtrip", "hash-roundtrip", () => input);
    const second = await registry.checkOrRecord("op-roundtrip", "hash-roundtrip", () => input);

    expect(first.status).toBe("recorded");
    expect(second.status).toBe("replayed");
    // The core invariant this fix restores: recorded === replayed, byte-identically.
    expect(first.result).toEqual(second.result);
    expect(first.result).toEqual({ when: "2026-01-01T00:00:00.000Z", n: null, kept: 1 });
  });
});

describe("IdempotencyRegistry.checkOrRecord — conflict semantics (never a silent overwrite)", () => {
  it("the SAME operationId with a DIFFERENT contentHash returns a typed conflict, and never re-executes compute", async () => {
    const registry = new IdempotencyRegistry(freshStore());
    const computeA = vi.fn(() => ({ value: "A" }));
    const computeB = vi.fn(() => ({ value: "B" }));

    const first = await registry.checkOrRecord("op-conflict", "hash-A", computeA);
    const second = await registry.checkOrRecord("op-conflict", "hash-B", computeB);

    expect(first.status).toBe("recorded");
    expect(second.status).toBe("conflict");
    expect(second.result).toBeUndefined();
    expect(computeB).not.toHaveBeenCalled();
  });

  it("a conflicting write never mutates the originally recorded result — a later call with the ORIGINAL hash still replays the original value", async () => {
    const registry = new IdempotencyRegistry(freshStore());
    await registry.checkOrRecord("op-no-overwrite", "hash-original", () => ({ value: "original" }));
    await registry.checkOrRecord("op-no-overwrite", "hash-different", () => ({
      value: "attempted-overwrite",
    }));

    const replay = await registry.checkOrRecord("op-no-overwrite", "hash-original", () => ({
      value: "should-not-run",
    }));

    expect(replay.status).toBe("replayed");
    expect(replay.result).toEqual({ value: "original" });
  });

  it("only ONE remote_operation_record entry is ever persisted for an operationId that later conflicts", async () => {
    const store = freshStore();
    const registry = new IdempotencyRegistry(store);
    await registry.checkOrRecord("op-single-entry", "hash-1", () => ({ v: 1 }));
    await registry.checkOrRecord("op-single-entry", "hash-2", () => ({ v: 2 }));
    await registry.checkOrRecord("op-single-entry", "hash-3", () => ({ v: 3 }));

    const entries = [];
    for await (const entry of store.queryEntries({ type: "remote_operation_record" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
  });
});

describe("IdempotencyRegistry.checkOrRecord — independent operationIds", () => {
  it("different operationIds with the same contentHash are recorded independently", async () => {
    const registry = new IdempotencyRegistry(freshStore());
    const first = await registry.checkOrRecord("op-A", "shared-hash", () => ({ owner: "A" }));
    const second = await registry.checkOrRecord("op-B", "shared-hash", () => ({ owner: "B" }));

    expect(first.status).toBe("recorded");
    expect(second.status).toBe("recorded");
    expect(second.result).toEqual({ owner: "B" });
  });
});

describe("property: randomized (operationId, contentHash) sequences never produce a silent overwrite", () => {
  it("matches a reference model across randomized sequential call sequences", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            operationId: fc.constantFrom("op-1", "op-2", "op-3"),
            contentHash: fc.constantFrom("hash-x", "hash-y", "hash-z"),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        async (calls) => {
          const registry = new IdempotencyRegistry(freshStore());
          // Reference model: the FIRST (operationId -> contentHash, result) pair
          // ever recorded for a given operationId, tracked independently of the
          // registry under test.
          const firstSeen = new Map<
            string,
            { readonly contentHash: string; readonly result: unknown }
          >();

          for (const call of calls) {
            const existing = firstSeen.get(call.operationId);

            const outcome = await registry.checkOrRecord(
              call.operationId,
              call.contentHash,
              () => ({
                operationId: call.operationId,
                contentHash: call.contentHash,
              }),
            );

            if (existing === undefined) {
              expect(outcome.status).toBe("recorded");
              firstSeen.set(call.operationId, {
                contentHash: call.contentHash,
                result: outcome.result,
              });
            } else if (existing.contentHash === call.contentHash) {
              expect(outcome.status).toBe("replayed");
              // The invariant under test: replay is always byte-identical to
              // whatever was recorded FIRST — never silently overwritten by a
              // later call, even after many intervening calls.
              expect(outcome.result).toEqual(existing.result);
            } else {
              expect(outcome.status).toBe("conflict");
              expect(outcome.result).toBeUndefined();
            }
          }

          // Final check: replaying the original hash for every operationId ever
          // seen still yields the ORIGINAL first-recorded result.
          for (const [operationId, record] of firstSeen) {
            const replay = await registry.checkOrRecord(operationId, record.contentHash, () => ({
              operationId,
              contentHash: "should-not-run",
            }));
            expect(replay.status).toBe("replayed");
            expect(replay.result).toEqual(record.result);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe("assertRemoteOperationRecordEntry — defensive type guard", () => {
  it("throws when given a JournalEntry that is NOT a remote_operation_record (should never happen via this module's own appendEntry calls, guarded defensively)", () => {
    const wrongTypeEntry = {
      schemaVersion: 1,
      seq: 1,
      type: "fanout_rationale",
      payload: { rationale: "not-an-operation-record" },
      prevHash: "0".repeat(64),
      hash: "1".repeat(64),
      timestamp: "2026-01-01T00:00:00.000Z",
    } as unknown as JournalEntry;

    expect(() => assertRemoteOperationRecordEntry(wrongTypeEntry)).toThrow(
      /wrong type .* for remote_operation_record/,
    );
  });
});

describe("IdempotencyRegistry — defensive branches (hand-crafted fixtures, per this module's own doc comment: 'should never happen via this module, but defensive against hand-crafted fixtures')", () => {
  it("skips a non-remote_operation_record entry even if it somehow reaches the index-building scan (queryEntries filter bypassed by a fake store)", async () => {
    const store = freshStore();
    // A real remote_operation_record entry exists...
    await store.appendEntry({
      type: "remote_operation_record",
      payload: {
        schemaVersion: 1,
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        remoteMutationPlanId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        operationId: "op-real",
        contentHash: "hash-real",
        status: "recorded",
        appliedRevision: JSON.stringify({ value: "real" }),
        recordedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    // A fake store wraps the real one but injects one extra, wrong-typed
    // entry into the async iterable queryEntries yields — simulating the
    // "should never happen" scenario the source's own comment names
    // (queryEntries is supposed to already filter by type; this proves the
    // registry's own redundant type check is a genuine, exercised defense,
    // not dead code).
    const fakeStore: JournalStore = {
      ...store,
      queryEntries: (filter) =>
        (async function* () {
          yield {
            schemaVersion: 1,
            seq: 999,
            type: "fanout_rationale",
            payload: { rationale: "wrong-type-injected" },
            prevHash: "0".repeat(64),
            hash: "f".repeat(64),
            timestamp: "2026-01-01T00:00:00.000Z",
          } as unknown as Awaited<ReturnType<JournalStore["appendEntry"]>>;
          yield* store.queryEntries(filter);
        })(),
    };

    const registry = new IdempotencyRegistry(fakeStore);
    const outcome = await registry.checkOrRecord("op-real", "hash-real", () => ({
      value: "should-not-run",
    }));
    expect(outcome.status).toBe("replayed");
    expect(outcome.result).toEqual("real");
  });

  it("keeps the FIRST entry authoritative when more than one remote_operation_record entry somehow exists for the same operationId", async () => {
    const store = freshStore();
    const commonPayload = {
      schemaVersion: 1 as const,
      remoteMutationPlanId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      operationId: "op-duplicated",
      status: "recorded" as const,
      recordedAt: "2026-01-01T00:00:00.000Z",
    };
    await store.appendEntry({
      type: "remote_operation_record",
      payload: {
        ...commonPayload,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        contentHash: "hash-first",
        appliedRevision: JSON.stringify({ value: "first" }),
      },
    });
    await store.appendEntry({
      type: "remote_operation_record",
      payload: {
        ...commonPayload,
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        contentHash: "hash-second",
        appliedRevision: JSON.stringify({ value: "second" }),
      },
    });

    const registry = new IdempotencyRegistry(store);
    const outcome = await registry.checkOrRecord("op-duplicated", "hash-first", () => ({
      value: "should-not-run",
    }));
    expect(outcome.status).toBe("replayed");
    expect(outcome.result).toEqual("first");
  });

  it("throws (rather than silently returning garbage) when replaying a hand-crafted record with no appliedRevision", async () => {
    const store = freshStore();
    await store.appendEntry({
      type: "remote_operation_record",
      payload: {
        schemaVersion: 1,
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        remoteMutationPlanId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        operationId: "op-no-revision",
        contentHash: "hash-no-revision",
        status: "recorded",
        // appliedRevision deliberately omitted — a hand-crafted/malformed record.
        recordedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const registry = new IdempotencyRegistry(store);
    await expect(
      registry.checkOrRecord("op-no-revision", "hash-no-revision", () => ({
        value: "should-not-run",
      })),
    ).rejects.toThrow();
  });
});
