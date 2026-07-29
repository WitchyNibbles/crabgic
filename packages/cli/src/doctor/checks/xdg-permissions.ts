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
    // ABSENT: the path cannot exist. `ENOTDIR` means a component of the path
    // is not a directory, so nothing can live below it; `ENAMETOOLONG` means
    // the name is unrepresentable. Round 17 measured both being reported as
    // "could not be inspected", which fired the new failure branch where the
    // old code was right to pass -- with evidence and remedy that were BOTH
    // false: the paths are absent, readability is not the fault, and chmod
    // cannot help.
    //
    // UNVERIFIED: everything else. `EACCES`/`EPERM`/`EIO`/`EOVERFLOW` and
    // `ELOOP` all mean something is there, or might be, and we could not look.
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" || code === "ENAMETOOLONG"
      ? undefined
      : "unknown";
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
          // BOTH steps when both problems are present. Round 17: emitting
          // only the chmod step meant that whenever any real violation
          // coexisted with an uninspectable path, "do not assume they are
          // absent" -- the entire point of the round-16 fix -- never reached
          // the owner, and they were told to chmod a path whose fault is that
          // it cannot be read. Worse, the test added alongside that fix
          // asserted the chmod step for exactly this shape, so the new test
          // was pinning the defect in place.
          repairStep: [
            ...(violations.length > 0
              ? [
                  "chmod the paths listed with a wrong mode back to their required mode (0700 dirs / 0600 files)",
                ]
              : []),
            ...(unknown.length > 0
              ? [
                  "make the uninspectable paths readable by this account and re-run, rather than assuming they are absent",
                ]
              : []),
          ].join("; "),
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
