import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attemptLeaseAcquire } from "./lease-acquire-attempt.js";

describe("attemptLeaseAcquire — in-process concurrent contention (fast analog of the real two-process test)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eo-lease-attempt-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("exactly one of two concurrent attempts against the same lease acquires it", async () => {
    const [a, b] = await Promise.all([
      attemptLeaseAcquire(dir, "proj-concurrent", 11_111, 150),
      attemptLeaseAcquire(dir, "proj-concurrent", 22_222, 150),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["ACQUIRED", "DENIED"]);

    const denied = a.outcome === "DENIED" ? a : b;
    expect(denied.reason).toBe("LeaseHeldError");
  });

  it("a fresh attempt after the prior holder released succeeds", async () => {
    const first = await attemptLeaseAcquire(dir, "proj-sequential", 1, 0);
    expect(first.outcome).toBe("ACQUIRED");

    const second = await attemptLeaseAcquire(dir, "proj-sequential", 2, 0);
    expect(second.outcome).toBe("ACQUIRED");
  });
});
