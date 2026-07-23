/**
 * XDG dir/file permission check — roadmap/09-cli-and-doctor.md §Doctor
 * checks: "XDG dirs 0700/0600." Targets the exact paths 04 (`@eo/journal`)
 * and 05 (`@eo/supervisor`) pin — never a re-derivation of the XDG layout
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

/** Injectable: reads back a path's low-9-bits mode, or `undefined` if it doesn't exist yet (not-yet-created is not itself a fault — a fresh install has nothing to check). */
export type StatModeFn = (path: string) => Promise<number | undefined>;

export async function realStatMode(path: string): Promise<number | undefined> {
  try {
    const st = await stat(path);
    return st.mode & 0o777;
  } catch {
    return undefined;
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
      let anyExisted = false;
      for (const expectation of options.paths) {
        const mode = await statMode(expectation.path);
        if (mode === undefined) continue;
        anyExisted = true;
        if (mode !== expectation.expectedMode) {
          violations.push(
            `${expectation.path} has mode 0${mode.toString(8)}, expected 0${expectation.expectedMode.toString(8)}`,
          );
        }
      }
      if (violations.length > 0) {
        return {
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence: violations.join("; "),
          repairStep: "chmod the listed paths back to their required mode (0700 dirs / 0600 files)",
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
