import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestJournal, type TestJournal } from "../test-support/test-journal.js";
import { getActiveQuarantine, quarantineTest } from "./quarantine-registry.js";

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

describe("flake quarantine registry", () => {
  it("a never-quarantined test has no active quarantine", async () => {
    expect(
      await getActiveQuarantine(tj.store, "suite/never-quarantined.test", "2026-01-01T00:00:00Z"),
    ).toBeUndefined();
  });

  it("an active (unexpired) quarantine is returned", async () => {
    await quarantineTest(tj.store, {
      testIdentifier: "suite/flaky.test",
      reason: "known flaky under CI load",
      expiresAt: "2026-06-01T00:00:00Z",
    });
    const active = await getActiveQuarantine(tj.store, "suite/flaky.test", "2026-01-01T00:00:00Z");
    expect(active?.testIdentifier).toBe("suite/flaky.test");
  });

  it("an EXPIRED quarantine reverts to blocking (returns undefined)", async () => {
    await quarantineTest(tj.store, {
      testIdentifier: "suite/flaky.test",
      reason: "known flaky",
      expiresAt: "2026-01-01T00:00:00Z",
    });
    const afterExpiry = await getActiveQuarantine(
      tj.store,
      "suite/flaky.test",
      "2026-06-01T00:00:00Z",
    );
    expect(afterExpiry).toBeUndefined();
  });

  it("returns the LATEST entry when a test was quarantined more than once", async () => {
    await quarantineTest(tj.store, {
      testIdentifier: "suite/flaky.test",
      reason: "first quarantine",
      expiresAt: "2026-01-01T00:00:00Z",
    });
    await quarantineTest(tj.store, {
      testIdentifier: "suite/flaky.test",
      reason: "re-quarantined",
      expiresAt: "2026-12-01T00:00:00Z",
    });
    const active = await getActiveQuarantine(tj.store, "suite/flaky.test", "2026-06-01T00:00:00Z");
    expect(active?.reason).toBe("re-quarantined");
  });
});
