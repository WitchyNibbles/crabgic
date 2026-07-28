/**
 * XDG dir/file permission check — roadmap/09-cli-and-doctor.md §Doctor
 * checks: "XDG dirs 0700/0600." Targets the exact paths 04 (`@crabgic/journal`)
 * and 05 (`@crabgic/supervisor`) pin — never a re-derivation of the XDG layout
 * (interface-ledger Gap 14).
 */
import { stat } from "node:fs/promises";
import type { DoctorCheck, DoctorFinding } from "../framework.js";

const CHECK_ID = "xdg.permissions";

export interface XdgPathExpectation {
  readonly path: string;
  readonly expectedMode: number;
  readonly kind: "dir" | "file";
}

/**
 * Injectable: reads back a path's low-9-bits mode.
 *
 * `undefined` means the path genuinely does not exist — a fresh install has
 * nothing to check, and that is not a fault. `"unknown"` means the mode could
 * not be determined, which is NOT the same thing and must never be reported
 * as absence.
 *
 * Roast round 16 found the difference mattered on pristine code: every `stat`
 * failure was laundered into `undefined`, so a state root at 0777 under an
 * unreadable parent reported **passed: true** with "no XDG state/cache paths
 * exist yet". The check asserted the paths did not exist when all it knew was
 * that it could not look. Reachable via `sudo crabgic doctor`, `ENOTDIR` or
 * `ELOOP`. The sibling check states the principle this violates outright:
 * "an assertion of absence is only sound when the probing command demonstrably
 * ran".
 */
export type StatModeFn = (path: string) => Promise<number | "unknown" | undefined>;

export async function realStatMode(path: string): Promise<number | "unknown" | undefined> {
  try {
    const st = await stat(path);
    return st.mode & 0o777;
  } catch (err) {
    // ONLY a genuinely missing path is absence. Anything else is a failure to
    // determine, and a permissions check that cannot look must say so rather
    // than pass.
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? undefined : "unknown";
  }
}

export interface XdgPermissionsCheckOptions {
  readonly paths: readonly XdgPathExpectation[];
  readonly statMode?: StatModeFn;
}

export function createXdgPermissionsCheck(options: XdgPermissionsCheckOptions): DoctorCheck {
  const statMode = options.statMode ?? realStatMode;
  return {
    id: CHECK_ID,
    severity: "error",
    async run(): Promise<DoctorFinding> {
      const violations: string[] = [];
      const unknown: string[] = [];
      let anyExisted = false;
      for (const expectation of options.paths) {
        const mode = await statMode(expectation.path);
        if (mode === undefined) continue;
        if (mode === "unknown") {
          // Cannot look is not the same as not there. Reported as a
          // violation, because a permissions check that silently passes on
          // the paths it could not read is worse than no check.
          unknown.push(expectation.path);
          continue;
        }
        anyExisted = true;
        if (mode !== expectation.expectedMode) {
          violations.push(
            `${expectation.path} has mode 0${mode.toString(8)}, expected 0${expectation.expectedMode.toString(8)}`,
          );
        }
      }
      if (violations.length > 0 || unknown.length > 0) {
        return {
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence: [
            ...violations,
            ...unknown.map((path) => `${path} could not be inspected, so its mode is unverified`),
          ].join("; "),
          repairStep:
            violations.length > 0
              ? "chmod the listed paths back to their required mode (0700 dirs / 0600 files)"
              : "make the listed paths readable by this account, then re-run; do not assume they are absent",
        };
      }
      return {
        id: CHECK_ID,
        severity: "error",
        passed: true,
        evidence: anyExisted
          ? "every existing XDG path has its required permission mode"
          : "no XDG state/cache paths exist yet (nothing to check on a fresh install)",
      };
    },
  };
}
