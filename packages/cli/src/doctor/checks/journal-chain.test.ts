import { describe, expect, it } from "vitest";
import { createJournalChainCheck } from "./journal-chain.js";

describe("createJournalChainCheck", () => {
  it("passes when the journal verifies clean", async () => {
    const check = createJournalChainCheck({
      journal: {
        verifyJournal: async () => ({
          segments: [],
          valid: true,
          totalValidEntries: 5,
        }),
      },
    });
    const finding = await check.run();
    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("5 valid entries");
  });
});
