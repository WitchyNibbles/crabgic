/**
 * Journal head-anchor check — the companion to `./journal-chain.ts`, covering
 * the one thing that check structurally cannot see.
 *
 * `journal.chain` calls `verifyJournal()`, which walks the SHA-256 chain from
 * genesis and confirms every link recomputes. That catches an entry edited in
 * place. It cannot catch a wholesale rewrite: recompute every hash forward and
 * the forged history verifies perfectly clean, because the chain carries no
 * secret to forge. Only a record of what the head USED to be can tell the two
 * apart, which is what `@crabgic/journal`'s head anchor is.
 *
 * Deliberately a SEPARATE check id rather than folded into `journal.chain`:
 * they fail for different reasons and have different remedies. A torn tail is
 * repairable; a head that no longer matches its anchor is an integrity
 * incident, and saying so with one id makes that distinction reportable.
 */
import { verifyRecordedHeadAnchor, type JournalStore } from "@crabgic/journal";
import type { DoctorCheck, DoctorFinding } from "../framework.js";

const CHECK_ID = "journal.head-anchor";

export interface JournalHeadAnchorCheckOptions {
  readonly journal: Pick<JournalStore, "queryEntries">;
  /** Absolute path of the recorded anchor. */
  readonly anchorPath: string;
}

export function createJournalHeadAnchorCheck(options: JournalHeadAnchorCheckOptions): DoctorCheck {
  return {
    id: CHECK_ID,
    severity: "error",
    async run(): Promise<DoctorFinding> {
      let verdict;
      try {
        verdict = await verifyRecordedHeadAnchor(
          options.journal as JournalStore,
          options.anchorPath,
        );
      } catch (error) {
        // An anchor that exists but cannot be trusted — mis-owned,
        // world-readable, malformed — is reported, never skipped. Skipping is
        // the fail-open this whole mechanism exists to prevent.
        return {
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence: `journal head anchor could not be read: ${error instanceof Error ? error.message : String(error)}`,
          repairStep:
            "inspect the anchor file's ownership and mode; if it was tampered with, treat the journal as suspect and compare against an off-host copy of the anchor",
        };
      }

      if (verdict === undefined) {
        return {
          id: CHECK_ID,
          severity: "error",
          passed: true,
          evidence:
            "no journal head anchor recorded yet — nothing to compare against (this is expected before the first anchor is taken)",
        };
      }

      if (verdict.ok) {
        return {
          id: CHECK_ID,
          severity: "error",
          passed: true,
          evidence: `journal head anchor holds: the anchored entry is still present, current head seq ${verdict.head.seq}`,
        };
      }

      const detail =
        verdict.reason === "head_behind_anchor"
          ? `the journal no longer reaches anchored seq ${verdict.anchoredSeq} — it was truncated, emptied, or replaced with a shorter history`
          : `the entry at anchored seq ${verdict.anchoredSeq} carries hash ${verdict.observedHash} where the anchor recorded ${verdict.anchoredHash} — the history under it was rewritten`;

      return {
        id: CHECK_ID,
        severity: "error",
        passed: false,
        evidence: `journal head anchor FAILED (${verdict.reason}): ${detail}`,
        repairStep:
          "this is not auto-repairable and is not a corruption case: a self-consistent journal that no longer matches its anchor was rewritten. Compare against an off-host copy of the anchor before trusting any run history",
      };
    },
  };
}
