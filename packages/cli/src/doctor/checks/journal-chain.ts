/**
 * Journal chain-verify check — roadmap/09-cli-and-doctor.md §Doctor checks:
 * "journal chain verify." §Interfaces consumed: "Journal chain-verification
 * routine — doctor's 'torn journal' check calls 04's own verifier, not a
 * reimplementation." This check calls `JournalStore.verifyJournal()`
 * directly — it never re-implements chain hashing/verification itself.
 */
import type { JournalStore } from "@eo/journal";
import type { DoctorCheck, DoctorFinding } from "../framework.js";

const CHECK_ID = "journal.chain";

export interface JournalChainCheckOptions {
  readonly journal: Pick<JournalStore, "verifyJournal">;
}

export function createJournalChainCheck(options: JournalChainCheckOptions): DoctorCheck {
  return {
    id: CHECK_ID,
    severity: "error",
    async run(): Promise<DoctorFinding> {
      const report = await options.journal.verifyJournal();
      if (!report.valid) {
        const firstInvalid = report.firstInvalid;
        const where =
          firstInvalid !== undefined
            ? `${firstInvalid.segmentFilePath} (${firstInvalid.issue.kind}, ${
                firstInvalid.isTailPosition ? "torn tail" : "mid-journal corruption"
              })`
            : "unknown segment";
        return {
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence: `journal chain verification failed at ${where}`,
          repairStep:
            firstInvalid?.isTailPosition === true
              ? "run the journal repair path (`repairJournal()`) to truncate the torn tail"
              : "investigate mid-journal corruption manually — this is NOT a safe auto-repair case",
        };
      }
      return {
        id: CHECK_ID,
        severity: "error",
        passed: true,
        evidence: `journal chain verified clean across ${String(report.segments.length)} segment(s), ${String(report.totalValidEntries)} valid entries`,
      };
    },
  };
}
