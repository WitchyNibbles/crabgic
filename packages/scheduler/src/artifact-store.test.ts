import { describe, expect, it } from "vitest";
import { ArtifactStore, ArtifactTooLargeError, MAX_ARTIFACT_BYTES } from "./artifact-store.js";

const WU = "11111111-1111-4111-8111-111111111111";
const ATTEMPT = "attempt-1";

describe("ArtifactStore", () => {
  it("stores and lists artifacts in insertion order", () => {
    const store = new ArtifactStore();
    store.put({ workUnitId: WU, attemptId: ATTEMPT, kind: "log", content: "first log line" });
    store.put({ workUnitId: WU, attemptId: ATTEMPT, kind: "test", content: "test output" });

    const records = store.list(WU, ATTEMPT);
    expect(records.map((r) => r.kind)).toEqual(["log", "test"]);
    expect(records[0]?.content).toBe("first log line");
  });

  it("scopes artifacts per (workUnitId, attemptId) — distinct attempts never see each other's records", () => {
    const store = new ArtifactStore();
    store.put({ workUnitId: WU, attemptId: "attempt-1", kind: "log", content: "attempt 1 log" });
    store.put({ workUnitId: WU, attemptId: "attempt-2", kind: "log", content: "attempt 2 log" });

    expect(store.list(WU, "attempt-1")).toHaveLength(1);
    expect(store.list(WU, "attempt-2")).toHaveLength(1);
    expect(store.list(WU, "attempt-1")[0]?.content).toBe("attempt 1 log");
  });

  it("returns an empty array for an unknown (workUnitId, attemptId)", () => {
    const store = new ArtifactStore();
    expect(store.list("unknown", "unknown")).toEqual([]);
  });

  it("throws ArtifactTooLargeError for over-bound content, storing nothing", () => {
    const store = new ArtifactStore();
    const oversized = "x".repeat(MAX_ARTIFACT_BYTES + 1);
    expect(() =>
      store.put({ workUnitId: WU, attemptId: ATTEMPT, kind: "log", content: oversized }),
    ).toThrow(ArtifactTooLargeError);
    expect(store.list(WU, ATTEMPT)).toEqual([]);
  });

  it("accepts content exactly at the bound", () => {
    const store = new ArtifactStore();
    const atBound = "x".repeat(MAX_ARTIFACT_BYTES);
    expect(() =>
      store.put({ workUnitId: WU, attemptId: ATTEMPT, kind: "log", content: atBound }),
    ).not.toThrow();
  });

  it("listBenchmarks returns only benchmark-kind artifacts — the slot 15 archives into", () => {
    const store = new ArtifactStore();
    store.put({ workUnitId: WU, attemptId: ATTEMPT, kind: "log", content: "log" });
    store.put({ workUnitId: WU, attemptId: ATTEMPT, kind: "benchmark", content: "bench sample 1" });
    store.put({ workUnitId: WU, attemptId: ATTEMPT, kind: "benchmark", content: "bench sample 2" });

    const benchmarks = store.listBenchmarks(WU, ATTEMPT);
    expect(benchmarks).toHaveLength(2);
    expect(benchmarks.every((r) => r.kind === "benchmark")).toBe(true);
  });

  it("projectSummary returns a compressed excerpt, never the full raw content", () => {
    const store = new ArtifactStore();
    const longContent = "y".repeat(1000);
    store.put({ workUnitId: WU, attemptId: ATTEMPT, kind: "log", content: longContent });

    const summaries = store.projectSummary(WU, ATTEMPT);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.byteLength).toBe(1000);
    expect(summaries[0]?.excerpt.length).toBeLessThan(1000);
    expect(summaries[0]?.excerpt).toBe(longContent.slice(0, 200));
    expect(summaries[0]).not.toHaveProperty("content");
  });

  it("recordCount tallies every artifact across every (workUnitId, attemptId)", () => {
    const store = new ArtifactStore();
    store.put({ workUnitId: WU, attemptId: "a1", kind: "log", content: "x" });
    store.put({ workUnitId: WU, attemptId: "a2", kind: "log", content: "y" });
    expect(store.recordCount).toBe(2);
  });

  it("two independently-constructed instances never observe each other's records, even for the identical (workUnitId, attemptId) key — the shadow-run isolation guarantee", () => {
    const primary = new ArtifactStore();
    const shadow = new ArtifactStore();
    primary.put({ workUnitId: WU, attemptId: ATTEMPT, kind: "log", content: "primary content" });
    shadow.put({ workUnitId: WU, attemptId: ATTEMPT, kind: "log", content: "shadow content" });

    expect(primary.list(WU, ATTEMPT)).toHaveLength(1);
    expect(primary.list(WU, ATTEMPT)[0]?.content).toBe("primary content");
    expect(shadow.list(WU, ATTEMPT)).toHaveLength(1);
    expect(shadow.list(WU, ATTEMPT)[0]?.content).toBe("shadow content");
  });
});
