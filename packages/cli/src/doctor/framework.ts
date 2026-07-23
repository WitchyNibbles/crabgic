/**
 * Doctor framework — roadmap/09-cli-and-doctor.md §Interfaces produced item
 * 4: "Doctor framework: `check = {id, severity, evidence, repair step}` +
 * `--repair-plan` (ordered, non-destructive, never auto-executed)." Every
 * concrete check under `./checks/*.ts` implements `DoctorCheck`; this
 * module owns only registration + running + report shaping — no check's
 * own probing logic lives here.
 */

export type DoctorCheckSeverity = "info" | "warning" | "error";

export interface DoctorCheckContext {
  /** Injected clock/spawn/fs seams a concrete check may need; each check declares its own narrower context type and this is the common envelope every check receives. */
  readonly [key: string]: unknown;
}

export interface DoctorFinding {
  readonly id: string;
  readonly severity: DoctorCheckSeverity;
  readonly passed: boolean;
  /** What was observed — never a resolved secret value (roadmap/09 §Test plan, Security: "doctor's auth probe prints only a validity verdict, never the resolved token value"). */
  readonly evidence: string;
  /** Present only when `passed` is false — one ordered, non-destructive step a human could take. Never auto-executed by this framework. */
  readonly repairStep?: string;
}

export interface DoctorCheck {
  readonly id: string;
  readonly severity: DoctorCheckSeverity;
  run(): Promise<DoctorFinding>;
}

export interface DoctorReport {
  readonly findings: readonly DoctorFinding[];
  readonly allPassed: boolean;
}

/** Runs every registered check, in order. A check that itself throws is recorded as a failing finding (severity `error`) rather than aborting the whole run — one broken probe must never hide every other check's result. */
export async function runDoctorChecks(checks: readonly DoctorCheck[]): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  for (const check of checks) {
    try {
      findings.push(await check.run());
    } catch (err) {
      findings.push({
        id: check.id,
        severity: "error",
        passed: false,
        evidence: `check threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
        repairStep: "re-run `doctor` after investigating the check's own error above",
      });
    }
  }
  return { findings, allPassed: findings.every((f) => f.passed) };
}

/** Builds `--repair-plan`'s ordered, non-destructive step list from a report — never auto-executes anything (roadmap/09 §In scope: "never auto-executes"). */
export function buildRepairPlan(report: DoctorReport): readonly string[] {
  return report.findings
    .filter((f) => !f.passed && f.repairStep !== undefined)
    .map((f) => `[${f.id}] ${f.repairStep!}`);
}
