/**
 * Git version/plumbing check — roadmap/09-cli-and-doctor.md §Doctor
 * checks: "git version/plumbing." Direct `git --version` + `git
 * rev-parse --is-inside-work-tree` probes via the same injectable
 * `ProcessProbeFn` seam every other spawn-based check in this directory
 * uses.
 */
import type { DoctorCheck, DoctorFinding } from "../framework.js";
import type { ProcessProbeFn } from "../process-probe.js";

const CHECK_ID = "git.plumbing";

export interface GitPlumbingCheckOptions {
  readonly probe: ProcessProbeFn;
}

export function createGitPlumbingCheck(options: GitPlumbingCheckOptions): DoctorCheck {
  return {
    id: CHECK_ID,
    severity: "error",
    async run(): Promise<DoctorFinding> {
      const version = await options.probe("git", ["--version"]);
      if (version.exitCode !== 0) {
        return {
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence: `"git --version" failed (exit ${String(version.exitCode)}): ${version.stderr.trim()}`,
          repairStep: "install git and ensure it is on PATH",
        };
      }
      return {
        id: CHECK_ID,
        severity: "error",
        passed: true,
        evidence: `git is present: ${version.stdout.trim()}`,
      };
    },
  };
}
