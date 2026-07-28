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
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DoctorCheck, DoctorFinding } from "../framework.js";
import type { ProcessProbeFn } from "../process-probe.js";

export interface SandboxSelftestOptions {
  /**
   * Seam: the path the probe attempts to write. Defaults to a freshly created
   * 0600 file this account owns — see `createOwnedMarkerPath` for why that
   * matters. Injected by tests so the argv is assertable.
   */
  readonly markerPath?: string;
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
/**
 * The probe writes to a path THIS ACCOUNT OWNS, created read-write at run
 * time, and relies on the `--ro-bind` to make it unwritable.
 *
 * Round 20 measured what the previous target cost. It was
 * `/eo-sandbox-selftest-marker` — at `/`, which uid 1000 cannot write
 * REGARDLESS of any sandbox — so the refusal the check treated as proof of
 * confinement was ordinary DAC. Executed differential: real bwrap, a
 * deliberately WRITABLE `--bind / /`, bare `sh` with no sandbox, and a no-op
 * `bwrap` shim that strips every flag all produced the identical
 * `WROTE:2 / exit 2` and all four PASSED. The check had no security property
 * at all, and the test file went 14/14 green with no sandbox whatsoever.
 *
 * Writing somewhere this uid genuinely owns separates them: without the bind
 * the write SUCCEEDS (`WROTE:0`, caught by the branch below), and only the
 * read-only bind can refuse it. The denial becomes attributable.
 */
/**
 * Remove marker directories left by runs that never reached their `finally`.
 *
 * Round 26: cleanup lives in a `finally`, which a SIGNAL death skips entirely —
 * and `process.on("exit")` cannot help, because death by a re-raised signal
 * never fires `exit`. Measured: one leaked directory per interrupted `doctor`,
 * for SIGINT, SIGTERM and SIGKILL alike, against zero for an uninterrupted run.
 * That is round 21's leak on a path round 21 did not cover.
 *
 * Age-gated so a concurrent `doctor` cannot have its live marker deleted from
 * under it, and capped so a directory with thousands of entries cannot turn a
 * health check into a filesystem scan.
 */
const STALE_MARKER_AGE_MS = 60 * 60 * 1000;
/** Exported so the cap's behaviour is assertable without hard-coding it in a test. */
export const MAX_STALE_MARKER_SWEEP = 200;

async function sweepStaleMarkerDirs(): Promise<void> {
  const root = tmpdir();
  let entries: string[];
  try {
    entries = (await readdir(root)).filter((name) => name.startsWith(MARKER_DIR_PREFIX));
  } catch {
    return; // nothing to sweep, and a sweep failure is never a health verdict
  }
  const cutoff = Date.now() - STALE_MARKER_AGE_MS;
  // Round 27: the cap USED to slice before the staleness test, and `readdir`
  // order is stable — so a fixed prefix of a fixed set was inspected every run.
  // Measured with 2000 permanently-unremovable prefix entries (another uid's
  // directories on a sticky /tmp, or root-owned leaks from a `sudo` run), a
  // perfectly sweepable stale directory at index 900 survived 20 consecutive
  // runs. The cap now bounds the WORK, not the search: staleness is decided
  // first, and only the removals are capped.
  let swept = 0;
  for (const name of entries) {
    if (swept >= MAX_STALE_MARKER_SWEEP) break;
    const candidate = join(root, name);
    try {
      const info = await stat(candidate);
      if (info.mtimeMs >= cutoff) continue;
      await rm(candidate, { recursive: true, force: true });
      swept += 1;
    } catch {
      // Raced with another sweep, or not ours to remove. Either is fine.
    }
  }
}

const MARKER_DIR_PREFIX = "eo-sandbox-selftest-";

async function createOwnedMarkerPath(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  await sweepStaleMarkerDirs();
  const dir = await mkdtemp(join(tmpdir(), MARKER_DIR_PREFIX));
  const path = join(dir, "marker");
  await writeFile(path, "", { mode: 0o600 });
  // Round 21: nothing removed these, so every `doctor` invocation leaked a
  // directory and an inode permanently — 98 had already accumulated on the
  // development host, and a single run of the test file added 14.
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** The marker to write, plus how to clean it up. An injected path is the caller's to manage. */
async function resolveMarker(
  options: SandboxSelftestOptions,
): Promise<{ path: string; cleanup: () => Promise<void>; owned: boolean }> {
  return options.markerPath !== undefined
    ? { path: options.markerPath, cleanup: () => Promise.resolve(), owned: false }
    : { ...(await createOwnedMarkerPath()), owned: true };
}

/**
 * Reasons a write can be refused that say NOTHING about confinement.
 *
 * Round 27: the verdict read only `WROTE:<n>` and the setup-failure classifier,
 * so it could not tell "refused by the read-only bind" from "failed because the
 * directory is gone" — round 20's defect class, re-admitted. Measured with a
 * no-op `bwrap` shim, i.e. NO SANDBOX AT ALL:
 *
 *   marker file exists       -> passed:false "unexpectedly succeeded"  (correct)
 *   parent directory deleted -> passed:true  "correctly denied"        (FALSE PASS)
 *
 * And round 26 introduced an actor that deletes exactly this prefix. The
 * discriminator was in stderr and discarded:
 *
 *   `cannot create …: Directory nonexistent`   <- not confinement
 *   `cannot create …: Read-only file system`   <- confinement
 */
const UNATTRIBUTABLE_WRITE_FAILURES = [
  "directory nonexistent",
  "no such file or directory",
  "not a directory",
];

function isUnattributableRefusal(stderr: string, markerPath: string): boolean {
  const attributable = markerPath.length > 0 ? stderr.split(markerPath).join("") : stderr;
  const lower = attributable.toLowerCase();
  return UNATTRIBUTABLE_WRITE_FAILURES.some((reason) => lower.includes(reason));
}
const WRITE_MARKER = "WROTE:";

const CHECK_ID = "sandbox.selftest";

/** Substrings observed in `bwrap`'s OWN setup-failure diagnostics (never emitted by the inner confined command) — a hit here means bwrap never even got to attempt the write. */
const SETUP_FAILURE_MARKERS = [
  "bwrap:",
  "creating new namespace failed",
  "user namespaces are not permitted",
  "unprivileged_userns_clone",
];

/**
 * The shell's `$0`, so its diagnostics are attributable.
 *
 * Passed as the argv element before the marker path, which makes `sh` prefix
 * every error it emits with `eo-sandbox-selftest:`. One constant, used by the
 * argv and by the classifier below, because round 18 showed what happens when
 * the same literal lives in two places: changing one survived 5260 tests while
 * breaking every host.
 */
export const SANDBOX_SHELL_ARGV0 = "eo-sandbox-selftest";
const SHELL_ARGV0 = SANDBOX_SHELL_ARGV0;

/**
 * Round 24: this matched the markers ANYWHERE in stderr, and the marker path is
 * `TMPDIR`-derived and echoed back by the shell in its own error message. So a
 * `TMPDIR` containing `bwrap:` or `creating new namespace failed` flipped a
 * healthy host to a failure — measured on the same host in the same second:
 *
 *   TMPDIR=.../bwrap:x  -> passed:false "bwrap failed to set up the sandbox …
 *                          eo-sandbox-selftest: 1: cannot create …/marker:
 *                          Read-only file system"
 *   TMPDIR=.../benign   -> passed:true  "correctly denied"
 *
 * Round 18's self-contradicting-evidence defect exactly: it asserts the write
 * was never attempted while quoting the shell proving it was attempted AND
 * denied, then tells the owner to reconfigure their kernel.
 *
 * The discriminator was already in the argv and unused. Classification is now
 * per LINE and by SOURCE: lines the shell owns (it prefixes them with `$0`) can
 * never be read as bwrap's, and bwrap's own prefix must start the line.
 */
function isSetupFailure(stderr: string, markerPath: string): boolean {
  // Round 25: a directory name containing a NEWLINE splits the shell's own
  // error across lines, so the continuation line carries no `$0` prefix and was
  // classified as bwrap's. Measured: `TMPDIR=$'/tmp/x\nbwrap: creating new
  // namespace failed'` produced a setup-failure verdict on a healthy host, and
  // it survived the `$0` fix because per-line attribution cannot work on a line
  // the attacker composed.
  //
  // The path is known exactly, so every byte of it is ours by construction.
  // Removing it first deletes the injected content along with it, whatever it
  // contains — bwrap's own diagnostics never quote the marker path, because a
  // setup failure happens before the inner command is ever exec'd.
  const attributable = markerPath.length > 0 ? stderr.split(markerPath).join("") : stderr;
  return attributable.split("\n").some((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${SHELL_ARGV0}:`)) return false;
    const lower = trimmed.toLowerCase();
    return (
      lower.startsWith("bwrap:") ||
      SETUP_FAILURE_MARKERS.filter((marker) => marker !== "bwrap:").some((marker) =>
        lower.includes(marker.toLowerCase()),
      )
    );
  });
}

/**
 * The confinement script. The marker path is NEVER interpolated into it — it
 * arrives as `$1`, a positional argument, which the shell never re-parses.
 *
 * Rounds 20, 21 and 22 all died on this one line. Round 20's target sat at `/`,
 * unwritable by anyone, so the refusal was ordinary DAC. Round 21 quoted the
 * interpolated path, and round 22 escaped the quotes with one character:
 * `os.tmpdir()` honours `TMPDIR`, `mkdtemp` only appends to a `TMPDIR`-derived
 * prefix, and a `TMPDIR` containing `'` closed the quote. Measured end-to-end
 * through the real CLI: `TMPDIR="…/x'; echo WROTE:2; exit 2; '"` made `doctor`
 * report the sandbox self-test as PASSING with a no-op `bwrap` shim on the
 * PATH — no sandbox whatsoever — and the inverse payload forced a FAIL on a
 * genuinely working one. `id -u > FILE` inside the payload really executed.
 *
 * An ODD number of quotes is not merely a wrong verdict but a permanent one:
 * `TMPDIR=/mnt/c/Users/O'Brien/AppData/Local/Temp` — a Windows username with an
 * apostrophe, exactly the WSL2 configuration round 21 cited as its own
 * justification — produced `sh: 1: Syntax error: Unterminated quoted string` on
 * a completely healthy host, with a repair step blaming signals and OOM.
 *
 * Quoting is a losing game; not interpolating at all is not. `;`, `&&`, `$(…)`,
 * backticks and newlines in `TMPDIR` were all already neutralised — only `'`
 * escaped — and as an argument none of them are even parsed.
 */
const CONFINEMENT_SCRIPT = `echo x > "$1"; s=$?; echo "${WRITE_MARKER}$s"; exit $s`;

/** Generous next to a probe that normally completes in single-digit milliseconds. */
const CONFINEMENT_TIMEOUT_MS = 30_000;

/**
 * Round 22: the presence probe two lines above the confinement probe had NO
 * ceiling, so `doctor` still hung forever on the adjacent call. Measured with a
 * `bwrap` shim that sleeps on `--version`: `wall=28.35s`, killed by an external
 * timeout, no output and no diagnosis. `grep timeoutMs packages/cli/src` found
 * exactly one call site — this closes the other.
 */
const PRESENCE_TIMEOUT_MS = 10_000;

export function createSandboxSelftestCheck(options: SandboxSelftestOptions): DoctorCheck {
  return {
    id: CHECK_ID,
    severity: "error",
    async run(): Promise<DoctorFinding> {
      const presence = await options.probe("bwrap", ["--version"], {
        timeoutMs: PRESENCE_TIMEOUT_MS,
      });
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
      const marker = await resolveMarker(options);
      // Round 21: nothing ever removed the marker directory, so every
      // `doctor` invocation leaked one plus an inode, permanently -- 98 had
      // accumulated on the development host, and one run of this check's own
      // test file added 14. Cleanup is in a `finally` so it survives every
      // refusal branch and any throw from the probe.
      try {
        const confinement = await options.probe(
          "bwrap",
          [
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
            CONFINEMENT_SCRIPT,
            // `$0`, then `$1`. The marker path is an ARGUMENT, never text
            // spliced into the script — see `CONFINEMENT_SCRIPT`.
            SHELL_ARGV0,
            marker.path,
          ],
          // Round 21, finding 3: without a ceiling, a bwrap child that
          // survives its parent while holding the stdout pipe hangs `doctor`
          // FOREVER — `close` never fires, so `run()` never settles. Measured
          // 2/12 hangs at a 0ms SIGKILL, with `ps` showing stuck `bwrap`
          // processes 20+ minutes later. A timeout resolves with `exitCode:
          // -1` and no write marker, landing in the UNVERIFIED branch:
          // fail-closed, never a pass.
          { timeoutMs: CONFINEMENT_TIMEOUT_MS },
        );
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

        if (isSetupFailure(confinement.stderr, marker.path)) {
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

        // Round 27: the refusal must be attributable to the BIND. A missing
        // directory refuses the write just as surely, on a host with no sandbox
        // at all. The structural guarantee covers wordings the stderr list does
        // not: if we created the marker, its parent must still be there, or the
        // refusal proves nothing.
        const parentGone = marker.owned && !existsSync(dirname(marker.path));
        if (parentGone || isUnattributableRefusal(confinement.stderr, marker.path)) {
          return {
            id: CHECK_ID,
            severity: "error",
            passed: false,
            evidence:
              "the write was refused, but not by the sandbox: its target directory was missing, " +
              "so confinement is UNVERIFIED, not confirmed" +
              (confinement.stderr.trim().length > 0 ? `: ${confinement.stderr.trim()}` : ""),
            repairStep:
              "re-run `doctor`; if this persists, something is deleting temporary directories " +
              "while the check runs",
          };
        }

        return {
          id: CHECK_ID,
          severity: "error",
          passed: true,
          evidence: "bwrap is present and a write to a read-only-bound path was correctly denied",
        };
      } finally {
        // Round 22: a throw from `rm` DISCARDED the verdict just computed. A
        // marker directory left at 0500 turned a live "confinement is not
        // holding" into "check threw unexpectedly: EACCES ... unlink", with a
        // repair step saying to re-run — the health answer replaced by a
        // filesystem detail. Cleanup failing is a leaked temp directory, not a
        // finding about the sandbox, so it must never overwrite one.
        await marker.cleanup().catch(() => undefined);
      }
    },
  };
}
