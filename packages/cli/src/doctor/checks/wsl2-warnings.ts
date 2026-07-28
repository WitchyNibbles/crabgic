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

/**
 * Any Windows drive mount, not just `/mnt/c`.
 *
 * Roast round 16, on pristine code: this tested `/mnt/c` alone while the
 * PASS evidence claimed the roots were "on the Linux filesystem". Measured
 * through the production path computation, `/mnt/d/wsl-state`,
 * `/mnt/C/Users/...` (capital) and a `HOME` under `/mnt/e` all passed while
 * being drvfs/9p — the check said the opposite of what it had established.
 * Every `/mnt/<letter>` is a drive mount with the same performance
 * characteristics, and the comparison is case-insensitive because WSL
 * accepts both.
 */
function isUnderWindowsDriveMount(path: string): boolean {
  return /^\/mnt\/[a-z](\/|$)/i.test(path);
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
      if (isUnderWindowsDriveMount(options.stateRootPath)) {
        warnings.push(
          `state root "${options.stateRootPath}" is under a Windows drive mount (slow 9p/drvfs filesystem)`,
        );
      }
      if (isUnderWindowsDriveMount(options.cacheRootPath)) {
        warnings.push(
          `cache root "${options.cacheRootPath}" is under a Windows drive mount (slow 9p/drvfs filesystem)`,
        );
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
