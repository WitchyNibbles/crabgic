/**
 * `bwrap` + sandbox self-test — roadmap/09-cli-and-doctor.md §Doctor
 * checks: "`bwrap` + sandbox self-test (probe worker asserts confinement)."
 * A DIRECT engine/host probe (spawns `bwrap` itself) — never an import of
 * `@eo/engine-claude`. Two sub-assertions, both against the same injectable
 * `ProcessProbeFn`: (1) `bwrap` is present on PATH; (2) a confined process
 * cannot write to a path bound read-only — the confinement self-test
 * itself.
 *
 * ADVERSARIAL-REVIEW FIX (2026-07-24): `confined = exitCode !== 0` alone is
 * unsound — `bwrap --unshare-all ...` also exits non-zero when unprivileged
 * user namespaces are disabled on the host (a SETUP failure, before the
 * inner write is ever attempted), which the prior code silently reported as
 * "write correctly denied" (a false PASS). `bwrap` itself always prefixes
 * ITS OWN diagnostics with the literal `"bwrap:"` on stderr when it fails to
 * set up the sandbox; once it successfully execs the inner command, any
 * further stderr comes from THAT command (`sh`'s own "Read-only file
 * system"/"Permission denied" wording, never bwrap-prefixed) — this is the
 * signal used below to tell the two failure modes apart.
 */
import type { DoctorCheck, DoctorFinding } from "../framework.js";
import type { ProcessProbeFn } from "../process-probe.js";

export interface SandboxSelftestOptions {
  readonly probe: ProcessProbeFn;
}

const CHECK_ID = "sandbox.selftest";

/** Substrings observed in `bwrap`'s OWN setup-failure diagnostics (never emitted by the inner confined command) — a hit here means bwrap never even got to attempt the write. */
const SETUP_FAILURE_MARKERS = [
  "bwrap:",
  "creating new namespace failed",
  "user namespaces are not permitted",
  "unprivileged_userns_clone",
];

function isSetupFailure(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return SETUP_FAILURE_MARKERS.some((marker) => lower.includes(marker.toLowerCase()));
}

export function createSandboxSelftestCheck(options: SandboxSelftestOptions): DoctorCheck {
  return {
    id: CHECK_ID,
    severity: "error",
    async run(): Promise<DoctorFinding> {
      const presence = await options.probe("bwrap", ["--version"]);
      if (presence.exitCode !== 0) {
        return {
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence: `"bwrap --version" failed (exit ${String(presence.exitCode)}): ${presence.stderr.trim()}`,
          repairStep: "install bubblewrap (`bwrap`) — required for sandboxed worker execution",
        };
      }

      // Confinement self-test: bind `/` read-only and attempt a write; a
      // correctly-confined sandbox must refuse the write (non-zero exit).
      const confinement = await options.probe("bwrap", [
        "--ro-bind",
        "/",
        "/",
        "--unshare-all",
        "--die-with-parent",
        "--",
        "sh",
        "-c",
        "echo x > /eo-sandbox-selftest-marker",
      ]);
      if (confinement.exitCode === 0) {
        return {
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence: "a write to a read-only-bound path inside bwrap unexpectedly succeeded",
          repairStep: "investigate the bwrap installation/kernel configuration — confinement is not holding",
        };
      }

      if (isSetupFailure(confinement.stderr)) {
        return {
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence: `bwrap failed to set up the sandbox before any write was attempted — confinement is UNVERIFIED, not confirmed: ${confinement.stderr.trim()}`,
          repairStep:
            "enable unprivileged user namespaces (e.g. `sysctl -w kernel.unprivileged_userns_clone=1`) or run under a host/container that permits bwrap's own namespace setup, then re-run `doctor`",
        };
      }

      return {
        id: CHECK_ID,
        severity: "error",
        passed: true,
        evidence: "bwrap is present and a write to a read-only-bound path was correctly denied",
      };
    },
  };
}
