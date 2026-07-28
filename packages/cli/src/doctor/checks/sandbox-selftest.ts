/**
 * `bwrap` + sandbox self-test — roadmap/09-cli-and-doctor.md §Doctor
 * checks: "`bwrap` + sandbox self-test (probe worker asserts confinement)."
 * A DIRECT engine/host probe (spawns `bwrap` itself) — never an import of
 * `@crabgic/engine-claude`. Two sub-assertions, both against the same injectable
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

/**
 * The path the probe tries to write, and the marker proving it tried.
 *
 * Both are shared between the argv and the verdict deliberately. Round 18:
 * with the marker written as a literal in two places, changing the argv alone
 * (`echo RAN` -> `echo RUN`) survived all 5260 tests while making EVERY host
 * fail forever, with evidence that contradicted itself in one sentence --
 * asserting the write was never attempted while quoting the stderr proving it
 * was attempted and denied. A single constant makes that mutation
 * unexpressible.
 */
const MARKER_PATH = "/eo-sandbox-selftest-marker";
const WRITE_MARKER = "WROTE:";

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
        // The marker comes AFTER the write and carries ITS exit status, so
        // it proves the write was ATTEMPTED — not merely that a shell
        // started.
        //
        // Round 17 put `echo RAN` first. Round 18 measured what that actually
        // bought: the marker lands ~1ms after spawn, so a SIGKILL at 2ms or
        // later leaves it present with empty stderr and a non-zero exit, and
        // the check reported "correctly denied" for a command that never
        // attempted any write. Verified against real bwrap at
        // `{stdout:"RAN\n", stderr:"", exitCode:137}` — verbatim the OOM case
        // the new tests enumerate. Killing at 10ms/50ms/200ms produced a
        // false PASS 10 times out of 10; only a kill inside the ~1ms exec
        // window behaved as the fixtures assumed. The fix passed its own
        // tests and missed reality.
        //
        // `$?` is captured whether the write succeeded or was refused, so the
        // marker is present in both legitimate outcomes and absent in exactly
        // the case that matters: the write never happened.
        // Attempt the write, CAPTURE its status, emit the marker, then exit
        // with the write's status. All three properties are needed and each
        // was broken by a previous attempt:
        //
        //   - the marker follows the write, so it proves the write was
        //     ATTEMPTED (round 17 put it first, and a kill at 10ms+ then
        //     produced a false "correctly denied" 10/10 against real bwrap);
        //   - the marker carries `$?`, so a broken sandbox is distinguishable
        //     from a working one;
        //   - `exit $s` restores the WRITE's status as the shell's. Round 18
        //     moved the write off the end, and `sh -c` exits with the LAST
        //     command's status -- always 0 from the echo -- so every healthy
        //     host fell into the "unexpectedly succeeded" branch. Measured
        //     0/20 PASS on a host where the write is demonstrably refused,
        //     while the check held `WROTE:2` and "Read-only file system" in
        //     hand and declared the write had succeeded.
        `echo x > ${MARKER_PATH}; s=$?; echo "${WRITE_MARKER}$s"; exit $s`,
      ]);
      if (confinement.exitCode === 0) {
        return {
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence: "a write to a read-only-bound path inside bwrap unexpectedly succeeded",
          repairStep:
            "investigate the bwrap installation/kernel configuration — confinement is not holding",
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

      // The executed-call guard, AFTER the bwrap-setup branch above. A setup
      // failure is a KNOWN reason the shell never ran and carries a far more
      // actionable remedy, so it must diagnose first; this catches the
      // remaining ways the command can fail to start — signal-kill (exit -1),
      // OOM (137), fork failure — which round 17 showed were all read as "the
      // write was correctly denied" from a command that never executed.
      // The marker's VALUE, not merely its presence. `WROTE:0` means the
      // write SUCCEEDED inside a read-only bind -- confinement is broken --
      // and reading only `includes(WRITE_MARKER)` left a broken sandbox
      // indistinguishable from a working one (round 19).
      if (confinement.stdout.includes(`${WRITE_MARKER}0`)) {
        return {
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence:
            "a write to a read-only-bound path inside bwrap unexpectedly SUCCEEDED — confinement is not holding",
          repairStep:
            "investigate the bwrap installation/kernel configuration — confinement is not holding",
        };
      }

      if (!confinement.stdout.includes(WRITE_MARKER)) {
        return {
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence:
            `the sandboxed shell never reported running (exit ${String(confinement.exitCode)}), ` +
            "so the write was never attempted — confinement is UNVERIFIED, not confirmed" +
            (confinement.stderr.trim().length > 0 ? `: ${confinement.stderr.trim()}` : ""),
          repairStep:
            "investigate why the sandboxed command did not start (signal, OOM, or fork failure); do not treat this as a passing sandbox",
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
