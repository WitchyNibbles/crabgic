import { describe, expect, it } from "vitest";
import { createTestJournal, reopenJournal } from "./testJournal.js";

describe("createTestJournal / reopenJournal", () => {
  it("creates a working JournalStore over a fresh temp directory, and reopenJournal sees prior writes", async () => {
    const journal = await createTestJournal();
    try {
      await journal.store.appendEntry({
        type: "fanout_rationale",
        payload: { rationale: "test entry" },
      });

      const reopened = reopenJournal(journal.journalDir);
      const entries: unknown[] = [];
      for await (const entry of reopened.queryEntries({ type: "fanout_rationale" })) {
        entries.push(entry);
      }
      expect(entries).toHaveLength(1);
    } finally {
      await journal.cleanup();
    }
  });

  it("cleanup() removes the temp directory (a second cleanup call is a harmless no-op)", async () => {
    const journal = await createTestJournal();
    await journal.cleanup();
    await expect(journal.cleanup()).resolves.toBeUndefined();
  });
});
