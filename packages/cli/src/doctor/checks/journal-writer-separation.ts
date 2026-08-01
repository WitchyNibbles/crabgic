/**
 * Journal writer-separation check — reports whether anything other than the
 * journal's own owner can write it.
 *
 * WHY THIS EXISTS. `docs/threat-model.md` names "same-uid trust flattening" as
 * a cross-surface theme: everything runs as the invoking uid, so a worker's
 * confinement rests on permission rules and an OS sandbox that (measurably)
 * does not cover the engine's own file tools. The durable fix is ownership —
 * a journal owned by a uid the worker does not run as cannot be written by it,
 * with no rule and no secret in the way.
 *
 * WHAT THIS CHECK DOES AND DOES NOT CLAIM. It reports the observable state of
 * the filesystem: who owns the journal directory and whether its mode leaves
 * group or other able to write. It does NOT claim the deployment is secure,
 * and it does not fail a single-uid deployment — that is the documented,
 * supported default, and flagging it as an error every run would train
 * operators to ignore the check. It fails only on a state that is wrong under
 * ANY model: a journal directory group- or world-writable.
 *
 * The advisory it emits when owner == current uid is the honest signal: this
 * host has no writer separation, and here is what that means.
 */
import { statSync } from "node:fs";
import type { DoctorCheck, DoctorFinding } from "../framework.js";

const CHECK_ID = "journal.writer-separation";

export interface JournalWriterSeparationCheckOptions {
  /** The journal directory whose ownership and mode are observed. */
  readonly journalDir: string;
  /** The uid this process runs as — injectable so tests need not run as two users. */
  readonly currentUid?: number;
  /** Injectable stat, so tests can describe a two-uid host this machine does not have. */
  readonly statPath?: (path: string) => { uid: number; mode: number } | undefined;
}

function defaultStat(path: string): { uid: number; mode: number } | undefined {
  try {
    const stats = statSync(path);
    return { uid: stats.uid, mode: stats.mode };
  } catch {
    return undefined;
  }
}

export function createJournalWriterSeparationCheck(
  options: JournalWriterSeparationCheckOptions,
): DoctorCheck {
  return {
    id: CHECK_ID,
    severity: "warning",
    run(): Promise<DoctorFinding> {
      const stat = (options.statPath ?? defaultStat)(options.journalDir);
      const currentUid = options.currentUid ?? process.getuid?.();

      if (stat === undefined) {
        return Promise.resolve({
          id: CHECK_ID,
          severity: "warning",
          passed: true,
          evidence: `no journal directory at ${options.journalDir} yet — nothing to separate`,
        });
      }

      // Wrong under every deployment model, single-uid included: anyone in the
      // group, or anyone at all, can append or rewrite history.
      const groupOrOtherWritable = (stat.mode & 0o022) !== 0;
      if (groupOrOtherWritable) {
        return Promise.resolve({
          id: CHECK_ID,
          severity: "warning",
          passed: false,
          evidence: `journal directory ${options.journalDir} is group- or world-writable (mode ${(stat.mode & 0o777).toString(8)}) — any account on this host can rewrite run history`,
          repairStep: `chmod 700 ${options.journalDir}`,
        });
      }

      if (currentUid !== undefined && stat.uid === currentUid) {
        return Promise.resolve({
          id: CHECK_ID,
          severity: "warning",
          passed: true,
          evidence:
            `no writer separation: the journal is owned by the uid this process runs as (${currentUid}), ` +
            "so every process this account starts — workers included — can write it. This is the supported " +
            "single-uid default, not a defect; separation means running the daemon as its own uid that owns " +
            "the state root (see docs/operator-guide.md)",
        });
      }

      return Promise.resolve({
        id: CHECK_ID,
        severity: "warning",
        passed: true,
        evidence: `writer separation in effect: the journal is owned by uid ${stat.uid}, not by this process's uid ${currentUid ?? "unknown"}`,
      });
    },
  };
}
