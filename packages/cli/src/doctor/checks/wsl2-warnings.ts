/**
 * WSL2 warnings — roadmap/09-cli-and-doctor.md §Doctor checks: "WSL2
 * warnings (`/mnt/c` state dirs, Windows-binary exclusions)." Informational
 * severity: this never blocks `doctor`'s overall pass/fail, it only flags a
 * likely-slow or likely-broken configuration for a human to notice.
 */
import type { DoctorCheck, DoctorFinding } from "../framework.js";

const CHECK_ID = "wsl2.warnings";

export interface Wsl2WarningsCheckOptions {
  /** Injectable: whether this host is WSL2 (real default reads `/proc/version` for "microsoft"). */
  readonly isWsl2: () => Promise<boolean>;
  readonly stateRootPath: string;
  readonly cacheRootPath: string;
}

function isUnderMntC(path: string): boolean {
  return path.startsWith("/mnt/c/") || path === "/mnt/c";
}

export function createWsl2WarningsCheck(options: Wsl2WarningsCheckOptions): DoctorCheck {
  return {
    id: CHECK_ID,
    severity: "warning",
    async run(): Promise<DoctorFinding> {
      const wsl2 = await options.isWsl2();
      if (!wsl2) {
        return {
          id: CHECK_ID,
          severity: "warning",
          passed: true,
          evidence: "not running under WSL2 — no WSL2-specific warnings apply",
        };
      }

      const warnings: string[] = [];
      if (isUnderMntC(options.stateRootPath)) {
        warnings.push(`state root "${options.stateRootPath}" is under /mnt/c (slow 9p filesystem)`);
      }
      if (isUnderMntC(options.cacheRootPath)) {
        warnings.push(`cache root "${options.cacheRootPath}" is under /mnt/c (slow 9p filesystem)`);
      }

      if (warnings.length > 0) {
        return {
          id: CHECK_ID,
          severity: "warning",
          passed: false,
          evidence: warnings.join("; "),
          repairStep:
            "move XDG_STATE_HOME/XDG_CACHE_HOME to the Linux filesystem (e.g. under $HOME), never /mnt/c, for acceptable I/O performance",
        };
      }
      return {
        id: CHECK_ID,
        severity: "warning",
        passed: true,
        evidence: "running under WSL2; state/cache roots are on the Linux filesystem, not /mnt/c",
      };
    },
  };
}
