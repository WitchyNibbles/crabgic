import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_STALE_MARKER_SWEEP,
  SANDBOX_SHELL_ARGV0,
  SCAN_LIMIT,
  createSandboxSelftestCheck,
  sweepCursorPath,
  sweepStaleMarkerDirs,
} from "./sandbox-selftest.js";

describe("createSandboxSelftestCheck", () => {
  it("passes when bwrap is present and confinement holds (write denied)", async () => {
    const check = createSandboxSelftestCheck({
      probe: async (_command, args) => {
        if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
        return { stdout: "WROTE:1\n", stderr: "Permission denied", exitCode: 1 };
      },
    });
    const finding = await check.run();
    expect(finding.passed).toBe(true);
  });

  it("fails when the confinement self-test's write unexpectedly succeeds", async () => {
    const check = createSandboxSelftestCheck({
      probe: async (_command, args) => {
        if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("unexpectedly succeeded");
  });

  it("adversarial-review regression guard: a host where bwrap fails SETUP (unprivileged userns disabled) is reported as UNVERIFIED, never as a false PASS", async () => {
    const check = createSandboxSelftestCheck({
      probe: async (_command, args) => {
        if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
        return {
          stdout: "",
          stderr:
            "bwrap: No permissions to creating new namespace, likely because the kernel does not allow non-privileged user namespaces. (Set the kernel.unprivileged_userns_clone sysctl to 1 if available.)",
          exitCode: 1,
        };
      },
    });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("failed to set up the sandbox");
    expect(finding.evidence).not.toContain("correctly denied");
    expect(finding.repairStep).toContain("unprivileged_userns_clone");
  });

  it("still passes for a genuine write-denial whose stderr carries no bwrap-setup marker", async () => {
    const check = createSandboxSelftestCheck({
      probe: async (_command, args) => {
        if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
        return {
          stdout: "WROTE:1\n",
          stderr: "sh: 1: cannot create /eo-sandbox-selftest-marker: Read-only file system",
          exitCode: 1,
        };
      },
    });
    const finding = await check.run();
    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("correctly denied");
  });
});

/**
 * Roast round 17, H3 — security-critical, and the same assertion-of-absence
 * class round 16 found in `xdg-permissions`, here in the confinement check.
 *
 * A signal-kill, an OOM, or a fork failure all produce a non-zero exit with
 * EMPTY stderr, and every one was read as "a write to a read-only-bound path
 * was correctly denied". A real denial on this host always carries `sh`'s own
 * "Read-only file system" message, so empty stderr is positive evidence the
 * inner command never ran — the opposite of what it was taken to mean.
 */
describe("sandbox-selftest — a denial requires proof the write was attempted", () => {
  function probeYielding(result: { stdout: string; stderr: string; exitCode: number }) {
    return createSandboxSelftestCheck({
      probe: async (_command, args) =>
        args.includes("--version") ? { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 } : result,
    });
  }

  it.each([
    ["signal-killed", { stdout: "", stderr: "", exitCode: -1 }],
    ["OOM-killed", { stdout: "", stderr: "", exitCode: 137 }],
    ["fork failure", { stdout: "", stderr: "sh: 1: Cannot fork\n", exitCode: 2 }],
    // ROUND 18: the shapes the round-17 marker could not distinguish. A kill
    // landing AFTER the shell started but BEFORE the write left the old
    // marker present with empty stderr -- measured against real bwrap as a
    // false PASS 10 times out of 10 at 10ms, 50ms and 200ms.
    ["killed after the shell started", { stdout: "", stderr: "", exitCode: 137 }],
    ["killed mid-write", { stdout: "", stderr: "", exitCode: -1 }],
  ])("reports %s as UNVERIFIED, never as a passing sandbox", async (_name, result) => {
    const finding = await probeYielding(result).run();

    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("never reported running");
    expect(finding.evidence).not.toContain("correctly denied");
    expect(finding.repairStep).toMatch(/do not treat this as a passing sandbox/);
  });

  it("still passes when the shell proves it ran and the write was refused", async () => {
    const finding = await probeYielding({
      stdout: "WROTE:1\n",
      stderr: "sh: 1: cannot create /eo-sandbox-selftest-marker: Read-only file system",
      exitCode: 1,
    }).run();

    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("correctly denied");
  });
});

/**
 * Round 18, finding 2: every test above injects a probe that DISCARDS the
 * argv, so changing `echo RAN` to `echo RUN` survived all 5260 tests while
 * making every host fail forever -- with evidence that contradicted itself in
 * one sentence, asserting the write was never attempted while quoting the
 * stderr proving it was attempted and denied.
 *
 * This executes the real argv against the real bwrap, and skips cleanly where
 * bwrap is unavailable rather than pretending to have checked.
 */
describe("sandbox-selftest — the real argv against the real bwrap", () => {
  it("PASSES on a host whose sandbox genuinely denies the write", async (ctx) => {
    const { createRealProcessProbe } = await import("../process-probe.js");
    const probe = createRealProcessProbe();

    const presence = await probe("bwrap", ["--version"]).catch(() => undefined);
    const bwrapPresent = presence !== undefined && presence.exitCode === 0;

    // ROUND 23: this used to be a bare `return`, so on a host without bwrap the
    // test reported a green tick having asserted NOTHING -- and the main CI
    // job installed no bubblewrap, which is exactly where the round-18 defect
    // class (`echo RAN` -> `echo RUN` survived 5260 tests) had to be caught.
    // CI now installs bubblewrap and sets this variable, so a missing sandbox
    // there is a failure rather than a silent pass; locally it still skips.
    if (!bwrapPresent) {
      if (process.env["CRABGIC_REQUIRE_BWRAP"] === "1") {
        throw new Error(
          "CRABGIC_REQUIRE_BWRAP=1 but `bwrap --version` failed: the confinement " +
            "self-test cannot be verified against a real sandbox on this host",
        );
      }
      ctx.skip();
      return;
    }

    const finding = await createSandboxSelftestCheck({ probe }).run();

    // ROUND 25: the skip above is gated on `bwrap --version`, which SUCCEEDS on
    // a host where bubblewrap is installed but the kernel forbids unprivileged
    // namespaces -- `ubuntu-latest` is Ubuntu 24.04, which restricts them by
    // default. So the skip was unreachable there and this test failed on a
    // required every-push job, which is exactly what round 24 believed it had
    // fixed; it changed the failure MESSAGE, not whether it failed. A host that
    // cannot build a sandbox has not disproved anything about confinement.
    if (!finding.passed && /failed to set up the sandbox/.test(finding.evidence)) {
      if (process.env["CRABGIC_REQUIRE_BWRAP"] === "1") {
        throw new Error(
          `CRABGIC_REQUIRE_BWRAP=1 but bwrap cannot set up a sandbox here: ${finding.evidence}`,
        );
      }
      ctx.skip();
      return;
    }

    // ROUND 19: the previous version of this test guarded on
    // /read-only file system/ against the EVIDENCE -- a string the PASS
    // branch never contains -- so zero assertions ever executed while the
    // check returned a flatly false verdict on this very host. A test that
    // cannot fire is worse than none.
    //
    // Asserted unconditionally instead: on a host with a working bwrap the
    // write must be refused and the check must say so.
    // ROUND 24: assert the EVIDENCE first. Asserting `passed` first reported
    // `expected false to be true` and discarded the check's own diagnosis --
    // which, on a runner whose kernel forbids unprivileged namespaces, names
    // the exact sysctl to set. A required job going red with a message that
    // says nothing is worse than one that explains itself.
    expect(finding.evidence).toContain("correctly denied");
    expect(finding.passed).toBe(true);
    expect(finding.evidence).not.toContain("unexpectedly");
    expect(finding.evidence).not.toContain("never reported running");
  });
});

describe("sandbox-selftest — the marker must follow the write", () => {
  it("emits the marker after the write, carrying its exit status", async () => {
    let confinementArgs: readonly string[] = [];
    const check = createSandboxSelftestCheck({
      markerPath: "/owned/marker",
      probe: async (_command, args) => {
        if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
        confinementArgs = args;
        return { stdout: "WROTE:1\n", stderr: "Read-only file system", exitCode: 1 };
      },
    });
    await check.run();

    // ROUND 22: the path is the LAST argv element and the script is the one
    // before `$0`. The path is no longer inside the script at all.
    expect(confinementArgs[confinementArgs.length - 1]).toBe("/owned/marker");
    const script = confinementArgs[confinementArgs.length - 3] ?? "";
    const writeAt = script.indexOf('> "$1"');
    const markerAt = script.indexOf("WROTE:");

    expect(writeAt).toBeGreaterThanOrEqual(0);
    expect(markerAt).toBeGreaterThan(writeAt);
    // And it must carry the write's status, not a constant.
    expect(script).toContain("$?");

    // ROUND 19: the three assertions above pin surface strings, and every
    // SEMANTIC mutation survived them -- wrapping the write in `if false;
    // then ... fi` (so it is never attempted, defeating the test's stated
    // purpose), decoupling `$?` with an intervening `true`, and redirecting
    // the marker to stderr so it never reaches the guard. The script's shape
    // is asserted as a whole instead.
    // ROUND 22: the target is a positional ARGUMENT. Quoting was escapable
    // with a single `'`; an argument is never re-parsed by the shell.
    expect(script).toBe('echo x > "$1"; s=$?; echo "WROTE:$s"; exit $s');

    // The read-only bind is the confinement under test; without it the probe
    // measures nothing. Deleting it survived every assertion.
    expect(confinementArgs).toContain("--ro-bind");
    expect(confinementArgs.join(" ")).toContain("--ro-bind / /");
  });
});

/**
 * The marker's VALUE, as a second, independent discriminator.
 *
 * With `exit $s` restored the exit status already carries the write's result,
 * so this branch is defence in depth rather than the primary signal -- and
 * round 19 showed why a second one is worth having: an earlier edit destroyed
 * the exit-status signal outright and left `includes(WRITE_MARKER)` unable to
 * tell a broken sandbox from a working one.
 *
 * The case it uniquely catches is DISAGREEMENT: stdout saying the write
 * succeeded while the exit status says otherwise. Something is wrong, and
 * "confinement holds" is not a safe reading of it.
 */
describe("sandbox-selftest — stdout and exit status must agree", () => {
  it("refuses to pass when the marker says the write succeeded", async () => {
    const finding = await createSandboxSelftestCheck({
      probe: async (_command, args) =>
        args.includes("--version")
          ? { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 }
          : // WROTE:0 -- the write worked -- yet a non-zero exit claims otherwise.
            { stdout: "WROTE:0\n", stderr: "", exitCode: 1 },
    }).run();

    expect(finding.passed).toBe(false);
    expect(finding.evidence).toMatch(/unexpectedly SUCCEEDED/);
  });

  it("passes only when the marker reports the write was refused", async () => {
    const finding = await createSandboxSelftestCheck({
      probe: async (_command, args) =>
        args.includes("--version")
          ? { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 }
          : { stdout: "WROTE:2\n", stderr: "Read-only file system", exitCode: 2 },
    }).run();

    expect(finding.passed).toBe(true);
  });
});

/**
 * Roast round 20, and the defect predated every fix in this series.
 *
 * The probe wrote to `/eo-sandbox-selftest-marker` -- at `/`, which uid 1000
 * cannot write REGARDLESS of any sandbox -- so the refusal the check called
 * proof of confinement was ordinary DAC. Measured: real bwrap, a deliberately
 * WRITABLE bind, bare `sh` with no sandbox, and a no-op `bwrap` shim that
 * strips every flag all produced identical output and all four PASSED. The
 * test file went 14/14 green with no sandbox at all.
 *
 * Writing somewhere this account owns is what makes the denial attributable
 * to the `--ro-bind` and nothing else.
 */
describe("sandbox-selftest — the probe target must be one this account owns", () => {
  it("defaults to a path it created, not an unwritable system path", async () => {
    let script = "";
    // ROUND 21: the writability assertion moved INSIDE the probe. The marker
    // directory is now removed in a `finally`, so checking after `run()`
    // resolves tests a path that has been deliberately deleted -- it would
    // fail for a reason that is not the property under test. Asserted at the
    // only moment it is meaningful: while the sandboxed write would be running.
    let writableDuringProbe: unknown = "probe never ran";
    let argvTarget = "";
    await createSandboxSelftestCheck({
      probe: async (_command, args) => {
        if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
        script = args[args.length - 3] ?? "";
        argvTarget = args[args.length - 1] ?? "";
        const { access, constants } = await import("node:fs/promises");
        const target = argvTarget;
        writableDuringProbe = await access(target, constants.W_OK).then(
          () => "writable",
          (err: unknown) => err,
        );
        return { stdout: "WROTE:2\n", stderr: "Read-only file system", exitCode: 2 };
      },
    }).run();

    // Not `/`: a write there is refused by ordinary permissions, so it
    // measures nothing about the sandbox.
    expect(script).not.toContain("/eo-sandbox-selftest-marker");
    // ROUND 22: read from the argv, not from the script text. Every previous
    // extraction regex here broke silently when the shape changed -- round
    // 21's `/> (\S+);/` yielded "" the moment the target was quoted, and its
    // replacement was itself quote-unsafe.
    const target = argvTarget;
    expect(target.split("/").length).toBeGreaterThan(2);

    // And it must really exist and be writable at the moment the sandboxed
    // write happens, or the probe would be refused for the wrong reason again.
    expect(writableDuringProbe).toBe("writable");
  });

  it("reports confinement broken when the owned path IS writable", async () => {
    // What a missing/no-op sandbox now looks like: the write succeeds.
    const finding = await createSandboxSelftestCheck({
      markerPath: "/owned/marker",
      probe: async (_command, args) =>
        args.includes("--version")
          ? { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 }
          : { stdout: "WROTE:0\n", stderr: "", exitCode: 0 },
    }).run();

    expect(finding.passed).toBe(false);
    expect(finding.evidence).toMatch(/unexpectedly succeeded/i);
  });
});

/**
 * Roast round 21 — the round-20 false PASS, reproduced verbatim through a
 * quoting defect.
 *
 * The marker path was interpolated UNQUOTED into `sh -c`, and it derives from
 * `os.tmpdir()`, which honours `TMPDIR`. Any whitespace truncated the redirect
 * target. This project explicitly targets WSL2, where
 * `TMPDIR=/mnt/c/Users/<name with space>/AppData/Local/Temp` is an ordinary
 * configuration.
 *
 * Measured with `TMPDIR="/tmp/r21b/John Smith"` and a sibling directory
 * `/tmp/r21b/John` present: real bwrap PASSED, and a **no-op `bwrap` shim that
 * strips every flag also PASSED** -- the shell redirected to `/tmp/r21b/John`,
 * a directory, refused by ordinary DAC on a host with no sandbox at all.
 *
 * Without any collision it is still wrong in a quieter way: the probe wrote
 * OUTSIDE its own owned directory (a 20-byte file at `/tmp/r21/John`), making
 * this check's central claim -- that it writes somewhere this account owns and
 * created -- false.
 */
describe("sandbox-selftest — a marker path with whitespace must not truncate", () => {
  async function argvForMarker(markerPath: string): Promise<readonly string[]> {
    let argv: readonly string[] = [];
    await createSandboxSelftestCheck({
      markerPath,
      probe: async (_command, args) => {
        if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
        argv = args;
        return { stdout: "WROTE:2\n", stderr: "Read-only file system", exitCode: 2 };
      },
    }).run();
    return argv;
  }

  it("keeps the whole path as the redirect target when TMPDIR contains a space", async () => {
    const marker = "/tmp/r21/John Smith/eo-sandbox-selftest-x/marker";
    const argv = await argvForMarker(marker);

    // The shell must see ONE word. ROUND 22: guaranteed structurally now --
    // the path is its own argv element, so the shell never word-splits it.
    expect(argv[argv.length - 1]).toBe(marker);
    expect(argv[argv.length - 3]).not.toContain(marker);
  });

  it("writes to the owned path itself, not to a truncated prefix of it", async () => {
    const { mkdtemp, rm, writeFile, access } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");

    // A real directory whose name contains a space, with a real sibling at the
    // truncation point -- the exact shape that produced the false PASS.
    const base = await mkdtemp(join(tmpdir(), "eo-r21-"));
    try {
      const owned = join(base, "John Smith");
      await mkdtemp(join(base, "John-")); // sibling near the truncation point
      const { mkdir } = await import("node:fs/promises");
      await mkdir(owned);
      const marker = join(owned, "marker");
      await writeFile(marker, "", { mode: 0o600 });

      const argv = await argvForMarker(marker);
      // Execute the REAL argv with no sandbox at all. The write must land on
      // the marker, proving the target is the owned path and nothing else.
      const shellArgs = argv.slice(argv.indexOf("-c"));
      await promisify(execFile)("sh", shellArgs).catch(() => undefined);
      await expect(access(marker)).resolves.toBeUndefined();
      const { readFile } = await import("node:fs/promises");
      expect((await readFile(marker, "utf8")).trim()).toBe("x");
      // And nothing was created at the truncation point.
      await expect(access(join(base, "John"))).rejects.toThrow();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

/**
 * Roast round 21, finding 2 — an unbounded leak.
 *
 * `createOwnedMarkerPath` called `mkdtemp` and nothing ever removed the result.
 * `grep -rn "eo-sandbox-selftest"` across `packages/`, `scripts/` and `e2e/`
 * found no cleanup anywhere. Measured: 10 direct runs left 10 directories, 5
 * runs through the real `runDoctor()` left 5, one run of this very file added
 * 14, and `/tmp` on the development host had accumulated **98** before anyone
 * looked. ~4 KB and one inode per `doctor` invocation, permanently.
 */
describe("sandbox-selftest — the marker directory must not leak", () => {
  async function countMarkerDirs(): Promise<number> {
    const { readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const entries = await readdir(tmpdir()).catch(() => [] as string[]);
    return entries.filter((name) => name.startsWith("eo-sandbox-selftest-")).length;
  }

  it("removes the directory it created, on the passing path", async () => {
    const before = await countMarkerDirs();
    await createSandboxSelftestCheck({
      probe: async (_command, args) =>
        args.includes("--version")
          ? { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 }
          : { stdout: "WROTE:2\n", stderr: "Read-only file system", exitCode: 2 },
    }).run();
    expect(await countMarkerDirs()).toBe(before);
  });

  it("removes it on a refusal path too, and when the probe throws", async () => {
    const before = await countMarkerDirs();

    // Confinement broken -> an early `return`, not the happy path.
    await createSandboxSelftestCheck({
      probe: async (_command, args) =>
        args.includes("--version")
          ? { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 }
          : { stdout: "WROTE:0\n", stderr: "", exitCode: 0 },
    }).run();

    // And a throw, which no `return`-site cleanup would survive.
    await expect(
      createSandboxSelftestCheck({
        probe: async (_command, args) => {
          if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
          throw new Error("spawn bwrap ENOENT");
        },
      }).run(),
    ).rejects.toThrow(/ENOENT/);

    expect(await countMarkerDirs()).toBe(before);
  });

  it("does not delete a caller-injected path, which is the caller's to manage", async () => {
    const { mkdtemp, rm, writeFile, access } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "eo-r21-injected-"));
    try {
      const marker = join(dir, "marker");
      await writeFile(marker, "", { mode: 0o600 });
      await createSandboxSelftestCheck({
        markerPath: marker,
        probe: async (_command, args) =>
          args.includes("--version")
            ? { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 }
            : { stdout: "WROTE:2\n", stderr: "Read-only file system", exitCode: 2 },
      }).run();
      await expect(access(marker)).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Round 21, finding 3, at the call site: the confinement probe must carry a
 * ceiling, or a surviving bwrap child hangs `crabgic doctor` with no output.
 */
describe("sandbox-selftest — the confinement probe must be bounded", () => {
  it("passes a timeout to the confinement spawn", async () => {
    let confinementOptions: unknown = "probe never called";
    await createSandboxSelftestCheck({
      markerPath: "/owned/marker",
      probe: async (_command, args, options) => {
        if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
        confinementOptions = options;
        return { stdout: "WROTE:2\n", stderr: "Read-only file system", exitCode: 2 };
      },
    }).run();

    expect(confinementOptions).toMatchObject({ timeoutMs: expect.any(Number) });
    expect((confinementOptions as { timeoutMs: number }).timeoutMs).toBeGreaterThan(0);
  });

  it("reports a timed-out probe as UNVERIFIED, never as a passing sandbox", async () => {
    // Exactly what the bounded probe returns on expiry.
    const finding = await createSandboxSelftestCheck({
      markerPath: "/owned/marker",
      probe: async (_command, args) =>
        args.includes("--version")
          ? { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 }
          : {
              stdout: "",
              stderr: "\n[probe timed out after 30000ms and was killed]",
              exitCode: -1,
            },
    }).run();

    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("never reported running");
    expect(finding.evidence).not.toContain("correctly denied");
  });
});

/**
 * Roast round 22 — the round-21 quoting fix was escapable with one character.
 *
 * `marker.path` was interpolated inside single quotes, and single quotes are
 * not an escape for a string that may contain a single quote. `os.tmpdir()`
 * honours `TMPDIR`; `mkdtemp` only appends random characters to a
 * `TMPDIR`-derived prefix.
 *
 * Measured end-to-end through the real CLI bundle against a no-op `bwrap` shim
 * -- a host with NO sandbox at all:
 *
 *   TMPDIR="…/x'; echo WROTE:2; exit 2; '"
 *     -> "✓ sandbox.selftest: … a write to a read-only-bound path was
 *         correctly denied"                                  <-- FALSE PASS
 *   TMPDIR="…/tmp-benign"
 *     -> "✗ sandbox.selftest: … unexpectedly succeeded"       <-- correct
 *
 * The inverse payload forced a FAIL on a genuinely working sandbox, and
 * `id -u > FILE` inside a payload really executed, so this was arbitrary
 * command execution, not merely verdict control.
 *
 * An ODD number of quotes is worse than a wrong verdict -- it is a permanent
 * one. `TMPDIR=/mnt/c/Users/O'Brien/AppData/Local/Temp` (a Windows username
 * with an apostrophe, exactly the WSL2 shape round 21 cited as its own
 * justification) produced `sh: 1: Syntax error: Unterminated quoted string` on
 * a completely healthy host.
 *
 * The fix is not better quoting. The path is a positional argument now, so the
 * shell never re-parses it.
 */
describe("sandbox-selftest — the marker path must not be shell-interpretable", () => {
  const PAYLOADS = [
    ["closes the quote and injects a passing verdict", `/tmp/x'; echo WROTE:2; exit 2; '/marker`],
    ["closes the quote and injects a failing verdict", `/tmp/x'; echo WROTE:0; exit 0; '/marker`],
    ["an odd quote, which broke the script outright", `/tmp/O'Brien/marker`],
    ["command substitution", "/tmp/$(id -u)/marker"],
    ["a backtick", "/tmp/`id -u`/marker"],
    ["a semicolon", "/tmp/a;id -u;b/marker"],
    ["a newline", "/tmp/a\nid -u\nb/marker"],
  ] as const;

  it.each(PAYLOADS)("keeps %s out of the script entirely", async (_name, markerPath) => {
    let argv: readonly string[] = [];
    await createSandboxSelftestCheck({
      markerPath,
      probe: async (_command, args) => {
        if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
        argv = args;
        return { stdout: "WROTE:2\n", stderr: "Read-only file system", exitCode: 2 };
      },
    }).run();

    const script = argv[argv.length - 3] ?? "";
    // The script is a CONSTANT. Nothing derived from the path appears in it.
    expect(script).toBe('echo x > "$1"; s=$?; echo "WROTE:$s"; exit $s');
    expect(script).not.toContain(markerPath);
    // And the path arrives whole, as its own argument.
    expect(argv[argv.length - 1]).toBe(markerPath);
  });

  it("executes the real argv without the payload running, and writes only the marker", async () => {
    const { mkdtemp, rm, mkdir, writeFile, access, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");

    const base = await mkdtemp(join(tmpdir(), "eo-r22-"));
    try {
      // A real directory whose name closes a single quote and appends a
      // command -- the exact payload that produced the false PASS.
      // No `/` — this is one directory NAME. The payload writes a relative
      // file, and the shell below runs with `cwd: base`, so a successful
      // injection is visible at `base/INJECTED`.
      const hostile = join(base, `x'; : > INJECTED; exit 2; '`);
      await mkdir(hostile);
      const marker = join(hostile, "marker");
      await writeFile(marker, "", { mode: 0o600 });

      let argv: readonly string[] = [];
      await createSandboxSelftestCheck({
        markerPath: marker,
        probe: async (_command, args) => {
          if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
          argv = args;
          return { stdout: "WROTE:2\n", stderr: "Read-only file system", exitCode: 2 };
        },
      }).run();

      // Run the REAL shell invocation, unsandboxed -- the worst case.
      const shellArgs = argv.slice(argv.indexOf("-c"));
      const { stdout } = await promisify(execFile)("sh", shellArgs, { cwd: base }).catch(
        (err: { stdout?: string }) => ({ stdout: err.stdout ?? "" }),
      );

      // The injected command did NOT run.
      await expect(access(join(base, "INJECTED"))).rejects.toThrow();
      // The write landed on the marker, and the marker line is the shell's own.
      expect((await readFile(marker, "utf8")).trim()).toBe("x");
      expect(stdout.trim()).toBe("WROTE:0");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

/**
 * Round 22, finding 3 — the presence probe two lines above the confinement
 * probe had no ceiling, so `doctor` still hung forever on the adjacent call.
 * Measured with a `bwrap` shim that sleeps on `--version`: `wall=28.35s`,
 * killed externally, no output and no diagnosis.
 */
describe("sandbox-selftest — the presence probe must be bounded too", () => {
  it("passes a timeout to `bwrap --version`", async () => {
    let presenceOptions: unknown = "probe never called";
    await createSandboxSelftestCheck({
      markerPath: "/owned/marker",
      probe: async (_command, args, options) => {
        if (args.includes("--version")) {
          presenceOptions = options;
          return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
        }
        return { stdout: "WROTE:2\n", stderr: "Read-only file system", exitCode: 2 };
      },
    }).run();

    expect(presenceOptions).toMatchObject({ timeoutMs: expect.any(Number) });
    expect((presenceOptions as { timeoutMs: number }).timeoutMs).toBeGreaterThan(0);
  });
});

/**
 * Round 22, finding 4 — a throw from the `finally` cleanup DISCARDED the
 * verdict just computed.
 *
 * Measured with the marker directory left at 0500: a live "confinement is not
 * holding" became "check threw unexpectedly: EACCES ... unlink", with a repair
 * step saying to re-run. Cleanup failing is a leaked temp directory, not a
 * finding about the sandbox, and must never overwrite one.
 */
describe("sandbox-selftest — a cleanup failure must not replace the verdict", () => {
  it("keeps a confinement FAILURE when cleanup throws", async () => {
    const { mkdtemp, chmod, rm, readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    // The check must take its REAL created-and-cleaned path, so `TMPDIR` is
    // pointed at a fresh empty directory. A first attempt injected
    // `markerPath` instead -- and that branch deliberately never calls `rm`,
    // so the test could not fire at all and the mutation survived it. Found by
    // mutation-checking the fix rather than by the suite going green.
    const sandbox = await mkdtemp(join(tmpdir(), "eo-r22-nocleanup-"));
    const previousTmpdir = process.env["TMPDIR"];
    process.env["TMPDIR"] = sandbox;
    let created: string | undefined;

    try {
      const finding = await createSandboxSelftestCheck({
        probe: async (_command, args) => {
          if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
          // The check created exactly one directory in this empty TMPDIR.
          // Stripping write permission makes `rm`'s unlink raise EACCES.
          const [only] = await readdir(sandbox);
          created = join(sandbox, only ?? "");
          await chmod(created, 0o500);
          // A live confinement failure: the write succeeded inside the bind.
          return { stdout: "WROTE:0\n", stderr: "", exitCode: 0 };
        },
      }).run();

      // The health answer survives, unaltered.
      expect(finding.passed).toBe(false);
      expect(finding.evidence).toMatch(/unexpectedly succeeded/i);
      expect(finding.evidence).not.toContain("threw unexpectedly");
      expect(finding.evidence).not.toContain("EACCES");
    } finally {
      if (previousTmpdir === undefined) delete process.env["TMPDIR"];
      else process.env["TMPDIR"] = previousTmpdir;
      if (created !== undefined) await chmod(created, 0o700).catch(() => undefined);
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("really does induce a cleanup throw, so the test above can fire", async () => {
    // Guards the guard: if `rm` stopped throwing for this shape, the test
    // above would pass for the wrong reason and prove nothing.
    const { mkdtemp, chmod, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = await mkdtemp(join(tmpdir(), "eo-r22-throws-"));
    await writeFile(join(dir, "marker"), "", { mode: 0o600 });
    await chmod(dir, 0o500);
    try {
      await expect(rm(dir, { recursive: true, force: true })).rejects.toThrow(/EACCES|EPERM/);
    } finally {
      await chmod(dir, 0o700).catch(() => undefined);
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

/**
 * Roast round 24 — a `TMPDIR` class rounds 21–23 all missed.
 *
 * `isSetupFailure` matched its markers ANYWHERE in stderr, and the marker path
 * is `TMPDIR`-derived and echoed back by the shell in its own error message. So
 * a `TMPDIR` containing `bwrap:` flipped a perfectly healthy host to a failure,
 * measured on the same host in the same second:
 *
 *   TMPDIR=.../bwrap:x -> passed:false "bwrap failed to set up the sandbox …"
 *   TMPDIR=.../benign  -> passed:true  "correctly denied"
 *
 * Round 18's self-contradicting-evidence defect exactly: it asserts the write
 * was never attempted while quoting the shell proving it was attempted AND
 * denied — then tells the owner to reconfigure their kernel.
 *
 * `$0` is the discriminator, and it was already in the argv, unused.
 */
describe("sandbox-selftest — a setup failure is decided by SOURCE, not substring", () => {
  function checkWithStderr(stderr: string) {
    return createSandboxSelftestCheck({
      markerPath: "/owned/marker",
      probe: async (_command, args) =>
        args.includes("--version")
          ? { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 }
          : { stdout: "WROTE:2\n", stderr, exitCode: 2 },
    });
  }

  // ROUND 25: these fixtures used to write `eo-sandbox-selftest:` as the shell
  // prefix while the argv passed `"sh"` -- so they encoded a host that did not
  // exist and were green against a defect that was live on every real one. The
  // prefix is DERIVED from the same constant the argv uses, so a fixture can no
  // longer disagree with the product.
  it.each([
    ["bwrap: in the path", "/tmp/bwrap:x/marker"],
    ["a userns phrase in the path", "/tmp/creating new namespace failed/marker"],
    ["the whole marker text in the path", "/tmp/unprivileged_userns_clone/marker"],
    // Round 25, finding 6: a NEWLINE in the path splits the shell's own error,
    // so the continuation line carries no prefix at all and was read as
    // bwrap's. Attribution by prefix cannot work on a line the attacker
    // composed; the known path is removed before anything is classified.
    ["a newline forging a bwrap line", "/tmp/x\nbwrap: creating new namespace failed/marker"],
  ])("does not read the SHELL's own error as bwrap's, for %s", async (_name, markerPath) => {
    const finding = await createSandboxSelftestCheck({
      markerPath,
      probe: async (_command, args) =>
        args.includes("--version")
          ? { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 }
          : {
              stdout: "WROTE:2\n",
              // What dash really prints, with `$0` as the argv supplies it.
              stderr: `${SANDBOX_SHELL_ARGV0}: 1: cannot create ${markerPath}: Read-only file system`,
              exitCode: 2,
            },
    }).run();

    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("correctly denied");
    expect(finding.evidence).not.toContain("failed to set up the sandbox");
  });

  it("does not read a mid-line `bwrap:` as bwrap's own diagnostic", async () => {
    // bwrap prefixes ITS diagnostics at the start of a line. A line from any
    // other source that merely contains the marker path -- which is
    // TMPDIR-derived and may contain anything -- is not evidence about the
    // sandbox. Mutation-checked: matching `bwrap:` anywhere in the line
    // survived every other test in this file.
    const finding = await checkWithStderr(
      "cannot create /tmp/bwrap:x/eo-sandbox-selftest-Ab12/marker: Read-only file system",
    ).run();

    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("correctly denied");
    expect(finding.evidence).not.toContain("failed to set up the sandbox");
  });

  it("still reports a REAL bwrap setup failure, whatever the path contains", async () => {
    const finding = await checkWithStderr(
      "bwrap: No permissions to creating new namespace, likely because the kernel does not " +
        "allow non-privileged user namespaces. (Set the kernel.unprivileged_userns_clone sysctl " +
        "to 1 if available.)",
    ).run();

    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("failed to set up the sandbox");
    expect(finding.repairStep).toContain("unprivileged_userns_clone");
  });

  it("reports a real setup failure even when a shell line is present too", async () => {
    // Both sources in one stderr: bwrap's line must still decide.
    const finding = await checkWithStderr(
      "eo-sandbox-selftest: 1: cannot create /tmp/x/marker: Read-only file system\n" +
        "bwrap: creating new namespace failed",
    ).run();

    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("failed to set up the sandbox");
  });
});

/**
 * Roast round 25, finding 1 — `SHELL_ARGV0` was declared, documented as "used
 * by the argv and by the classifier", and passed to NEITHER: the argv shipped
 * the literal `"sh"`. So `startsWith("eo-sandbox-selftest:")` could never match
 * a real shell and the whole source-attribution fix was dead code, while the
 * tests stayed green because their fixtures wrote the prefix the argv did not
 * send. Three of four marker `TMPDIR`s still produced a false setup-failure on
 * a healthy host.
 *
 * (It got there as a leftover mutation: a mutation-testing batch timed out
 * before its restore ran, and the mutant was committed. The lesson is the test
 * below, not the anecdote — nothing asserted the wiring.)
 */
describe("sandbox-selftest — the shell's $0 must actually be sent", () => {
  it("passes SANDBOX_SHELL_ARGV0 as $0, so the shell's own errors are attributable", async () => {
    let argv: readonly string[] = [];
    await createSandboxSelftestCheck({
      markerPath: "/owned/marker",
      probe: async (_command, args) => {
        if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
        argv = args;
        return { stdout: "WROTE:2\n", stderr: "Read-only file system", exitCode: 2 };
      },
    }).run();

    // `$0` is the element before the path, and it must be the constant the
    // classifier reads -- not a literal that can drift from it.
    expect(argv[argv.length - 2]).toBe(SANDBOX_SHELL_ARGV0);
    expect(argv[argv.length - 1]).toBe("/owned/marker");
  });

  it("really does make a shell prefix its diagnostics with it", async () => {
    // Executed, not asserted from documentation: run the real argv's shell
    // portion and read what the shell actually prints.
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");

    let argv: readonly string[] = [];
    await createSandboxSelftestCheck({
      markerPath: "/proc/definitely-not-writable/marker",
      probe: async (_command, args) => {
        if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
        argv = args;
        return { stdout: "WROTE:2\n", stderr: "", exitCode: 2 };
      },
    }).run();

    const shellArgs = argv.slice(argv.indexOf("-c"));
    const { stderr } = await promisify(execFile)("sh", shellArgs).catch(
      (err: { stderr?: string }) => ({ stderr: err.stderr ?? "" }),
    );

    expect(stderr.trim()).toMatch(new RegExp(`^${SANDBOX_SHELL_ARGV0}:`));
  });
});

/**
 * Roast round 26, finding 3 — an interrupted `doctor` leaked a marker directory.
 *
 * Cleanup is in a `finally`, which a signal death skips, and `process.on("exit")`
 * cannot help because death by a re-raised signal never fires it. Measured with
 * a `bwrap` that answers `--version` then hangs, so the marker really exists:
 * SIGINT, SIGTERM and SIGKILL each left one behind; an uninterrupted run left
 * none. Round 21's leak, on the one path round 21 did not cover.
 */
describe("sandbox-selftest — stale markers from interrupted runs are swept", () => {
  it("removes an old marker directory and leaves a fresh one alone", async () => {
    const { mkdtemp, mkdir, rm, utimes, access } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const sandbox = await mkdtemp(join(tmpdir(), "eo-r26-sweep-"));
    const previousTmpdir = process.env["TMPDIR"];
    process.env["TMPDIR"] = sandbox;
    try {
      const stale = join(sandbox, "eo-sandbox-selftest-STALE1");
      const fresh = join(sandbox, "eo-sandbox-selftest-FRESH1");
      const unrelated = join(sandbox, "something-else-STALE");
      for (const dir of [stale, fresh, unrelated]) await mkdir(dir);

      // Two hours old, comfortably past the one-hour cutoff.
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await utimes(stale, old, old);
      await utimes(unrelated, old, old);

      await createSandboxSelftestCheck({
        probe: async (_command, args) =>
          args.includes("--version")
            ? { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 }
            : { stdout: "WROTE:2\n", stderr: "Read-only file system", exitCode: 2 },
      }).run();

      // The abandoned one is gone.
      await expect(access(stale)).rejects.toThrow();
      // A concurrent run's live marker is NOT, which is why the sweep is age-gated.
      await expect(access(fresh)).resolves.toBeUndefined();
      // And nothing outside our own prefix is touched.
      await expect(access(unrelated)).resolves.toBeUndefined();
    } finally {
      if (previousTmpdir === undefined) delete process.env["TMPDIR"];
      else process.env["TMPDIR"] = previousTmpdir;
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

/**
 * Roast round 27, finding 2 — a refusal must be attributable to the BIND.
 *
 * The verdict read only `WROTE:<n>` and the setup-failure classifier, so a write
 * that failed because its directory was gone was indistinguishable from one the
 * sandbox denied. Measured with a no-op `bwrap` shim — no sandbox at all:
 *
 *   marker file exists       -> passed:false "unexpectedly succeeded"  (correct)
 *   parent directory deleted -> passed:true  "correctly denied"        (FALSE PASS)
 *
 * Round 20's defect class re-admitted, and round 26 introduced a sweeper for
 * exactly this prefix, which makes concurrent deletion a live path rather than a
 * hypothetical one.
 */
describe("sandbox-selftest — a refusal must come from the sandbox, not a missing directory", () => {
  it.each([
    ["dash's wording", "eo-sandbox-selftest: 1: cannot create /t/x/marker: Directory nonexistent"],
    ["errno wording", "sh: cannot create /t/x/marker: No such file or directory"],
    ["a file in the path", "sh: cannot create /t/x/marker: Not a directory"],
  ])("refuses to pass when the write failed for %s", async (_name, stderr) => {
    const finding = await createSandboxSelftestCheck({
      markerPath: "/t/x/marker",
      probe: async (_command, args) =>
        args.includes("--version")
          ? { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 }
          : { stdout: "WROTE:2\n", stderr, exitCode: 2 },
    }).run();

    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("not by the sandbox");
    expect(finding.evidence).not.toContain("correctly denied");
  });

  it("fails when the marker it created has had its directory deleted underneath it", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { readdir } = await import("node:fs/promises");

    const sandbox = await mkdtemp(join(tmpdir(), "eo-r27-vanish-"));
    const previousTmpdir = process.env["TMPDIR"];
    process.env["TMPDIR"] = sandbox;
    try {
      const finding = await createSandboxSelftestCheck({
        probe: async (_command, args) => {
          if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
          // Delete the marker's directory while the "sandbox" runs -- what a
          // concurrent sweep or an operator's `rm -rf` does.
          for (const name of await readdir(sandbox)) {
            await rm(join(sandbox, name), { recursive: true, force: true });
          }
          // A refusal with NO stderr at all: only the structural check can
          // catch this one.
          return { stdout: "WROTE:2\n", stderr: "", exitCode: 2 };
        },
      }).run();

      expect(finding.passed).toBe(false);
      expect(finding.evidence).toContain("not by the sandbox");
    } finally {
      if (previousTmpdir === undefined) delete process.env["TMPDIR"];
      else process.env["TMPDIR"] = previousTmpdir;
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("still passes a genuine read-only-bind denial", async () => {
    const finding = await createSandboxSelftestCheck({
      markerPath: "/t/x/marker",
      probe: async (_command, args) =>
        args.includes("--version")
          ? { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 }
          : {
              stdout: "WROTE:2\n",
              stderr: "eo-sandbox-selftest: 1: cannot create /t/x/marker: Read-only file system",
              exitCode: 2,
            },
    }).run();

    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("correctly denied");
  });
});

/**
 * Roast round 28 — the sweep must be bounded in BOTH dimensions.
 *
 * Round 27 capped only removals, to defeat the starvation its predecessor had.
 * `swept` counts only SUCCESSFUL removals, so unremovable entries never advance
 * the cap and every run re-stats the whole directory forever: 20,000 entries
 * cost 7.3-7.6s against 104ms for the code it replaced, permanently, with the
 * docblock still promising a health check could not become a filesystem scan.
 *
 * And round 27's own test could not see it — it seeded only REMOVABLE stale
 * dirs, where both loops behave identically, so the literal prior code was
 * 204/204 green. That is round 27's finding 1 (a paraphrased mutation gives
 * false confidence) reproduced inside round 27's own fix.
 *
 * These seed UNREMOVABLE entries, which is the only shape that separates them.
 */
describe("sandbox-selftest — the stale sweep is bounded in scan AND removals", () => {
  async function seed(
    dir: string,
    count: number,
    kind: "removable" | "unremovable",
    prefix: string,
  ): Promise<void> {
    const { mkdir, writeFile, chmod, utimes } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (let i = 0; i < count; i += 1) {
      const entry = join(dir, `eo-sandbox-selftest-${prefix}${String(i).padStart(5, "0")}`);
      await mkdir(entry);
      if (kind === "unremovable") {
        // Non-empty and mode 0500: `rm -r` cannot unlink through it.
        await writeFile(join(entry, "held"), "");
        await chmod(entry, 0o500);
      }
      await utimes(entry, old, old);
    }
  }

  async function withSandbox<T>(run: (dir: string) => Promise<T>): Promise<T> {
    const { mkdtemp, rm, readdir, chmod } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "eo-r28-sweep-"));
    try {
      return await run(dir);
    } finally {
      for (const name of await readdir(dir)) {
        await chmod(join(dir, name), 0o700).catch(() => undefined);
      }
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("examines at most SCAN_LIMIT entries, so unremovable ones cannot make it unbounded", async () => {
    const { readdir } = await import("node:fs/promises");
    await withSandbox(async (dir) => {
      const previous = process.env["TMPDIR"];
      process.env["TMPDIR"] = dir;
      try {
        // A wall of unremovable entries, then one removable one BEYOND the
        // scan window. Round 27's loop would stat every entry to reach it.
        await seed(dir, SCAN_LIMIT + 50, "unremovable", "U");
        await seed(dir, 1, "removable", "Z");
        const before = (await readdir(dir)).length;

        // Starting at 0, the removable entry is past the window.
        await sweepStaleMarkerDirs(0);
        expect((await readdir(dir)).length).toBe(before);

        // Starting past the wall, the rotation reaches it -- so bounding the
        // scan does not reintroduce starvation.
        await sweepStaleMarkerDirs(SCAN_LIMIT + 40);
        expect((await readdir(dir)).length).toBe(before - 1);
      } finally {
        if (previous === undefined) delete process.env["TMPDIR"];
        else process.env["TMPDIR"] = previous;
      }
    });
  }, 60_000);

  it("removes at most MAX_STALE_MARKER_SWEEP per run, and converges", async () => {
    const { readdir } = await import("node:fs/promises");
    await withSandbox(async (dir) => {
      const previous = process.env["TMPDIR"];
      process.env["TMPDIR"] = dir;
      try {
        const total = MAX_STALE_MARKER_SWEEP + 25;
        await seed(dir, total, "removable", "R");

        await sweepStaleMarkerDirs(0);
        expect((await readdir(dir)).length).toBe(total - MAX_STALE_MARKER_SWEEP);

        await sweepStaleMarkerDirs(0);
        expect((await readdir(dir)).length).toBe(0);
      } finally {
        if (previous === undefined) delete process.env["TMPDIR"];
        else process.env["TMPDIR"] = previous;
      }
    });
  }, 60_000);

  it("never removes a fresh directory, whatever the offset", async () => {
    const { readdir, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await withSandbox(async (dir) => {
      const previous = process.env["TMPDIR"];
      process.env["TMPDIR"] = dir;
      try {
        await seed(dir, 5, "removable", "S");
        await mkdir(join(dir, "eo-sandbox-selftest-LIVE"));

        await sweepStaleMarkerDirs(0);
        const left = await readdir(dir);
        expect(left).toEqual(["eo-sandbox-selftest-LIVE"]);
      } finally {
        if (previous === undefined) delete process.env["TMPDIR"];
        else process.env["TMPDIR"] = previous;
      }
    });
  });
});

/**
 * Roast round 29 — the rotation was uncovered, and it did not rotate.
 *
 * Round 28's anti-starvation mechanism survived being deleted outright:
 * `rotatingOffset()` → `return 0` left the whole doctor directory at 206/206,
 * because every test passed an explicit offset and nothing exercised the
 * default. Coverage reported the function at 100% — it was EXECUTED by 17 tests
 * and ASSERTED by none. That is the third round running in which the headline
 * fix shipped without coverage.
 *
 * And the mechanism itself was wrong: derived from `Date.now()/1000`, it
 * advanced with the wall clock rather than with invocations. Measured, 297 real
 * runs in 60s visited **61** of 600 start positions — 0.2 entries per run — so
 * a script looping `doctor` 1,000 times covers ~40 positions out of 20,000. A
 * FIXED period was worse: at N=900 with a 15-minute timer, 5,000 runs visited
 * exactly ONE start value, making the docblock's "rather than never" false.
 */
describe("sandbox-selftest — the sweep window advances once per run", () => {
  async function withTmpdir<T>(run: (dir: string) => Promise<T>): Promise<T> {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "eo-r29-cursor-"));
    // Round 30 moved the cursor out of TMPDIR, so a test that wants a private
    // cursor must give the run a private state home too.
    const state = await mkdtemp(join(tmpdir(), "eo-r29-state-"));
    const previous = process.env["TMPDIR"];
    const previousState = process.env["XDG_STATE_HOME"];
    process.env["TMPDIR"] = dir;
    process.env["XDG_STATE_HOME"] = state;
    try {
      return await run(dir);
    } finally {
      if (previous === undefined) delete process.env["TMPDIR"];
      else process.env["TMPDIR"] = previous;
      if (previousState === undefined) delete process.env["XDG_STATE_HOME"];
      else process.env["XDG_STATE_HOME"] = previousState;
      await rm(dir, { recursive: true, force: true });
      await rm(state, { recursive: true, force: true });
    }
  }

  /** Marker dirs whose names encode their index, so a removal names its window. */
  async function seedStale(dir: string, count: number): Promise<void> {
    const { mkdir, utimes } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (let i = 0; i < count; i += 1) {
      const entry = join(dir, `eo-sandbox-selftest-${String(i).padStart(5, "0")}`);
      await mkdir(entry);
      await utimes(entry, old, old);
    }
  }

  it("moves a full scan window per invocation, not per elapsed second", async () => {
    const { readdir } = await import("node:fs/promises");
    await withTmpdir(async (dir) => {
      // More than one window's worth, so a second run must reach new ground.
      await seedStale(dir, SCAN_LIMIT + MAX_STALE_MARKER_SWEEP);
      const marked = (n: string): boolean => n.startsWith("eo-sandbox-selftest-");

      // No explicit offset: this is the production path round 28 never tested.
      await sweepStaleMarkerDirs();
      const afterFirst = (await readdir(dir)).filter(marked);

      // Immediately -- same wall-clock second. Under the clock-derived offset
      // this second run re-scanned the same window and removed nothing new.
      await sweepStaleMarkerDirs();
      const afterSecond = (await readdir(dir)).filter(marked);

      expect(afterFirst.length).toBeLessThan(SCAN_LIMIT + MAX_STALE_MARKER_SWEEP);
      expect(afterSecond.length).toBeLessThan(afterFirst.length);
    });
  }, 60_000);

  it("persists its cursor between processes, and the cursor is never swept", async () => {
    const { readFile } = await import("node:fs/promises");
    await withTmpdir(async (dir) => {
      await seedStale(dir, 10);
      await sweepStaleMarkerDirs();

      // The cursor exists and holds a number. Round 30 moved it OUT of TMPDIR
      // — see the round-30 block below for why — so it cannot be swept by
      // construction rather than by being named around the prefix filter.
      const value = Number.parseInt((await readFile(sweepCursorPath() as string, "utf8")).trim(), 10);
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(SCAN_LIMIT);
    });
  });

  it("still sweeps when the cursor cannot be persisted", async () => {
    const { readdir, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await withTmpdir(async (dir) => {
      await seedStale(dir, 5);
      // A DIRECTORY where the cursor file belongs: every write fails.
      const cursor = sweepCursorPath() as string;
      await mkdir(dirname(cursor), { recursive: true });
      await mkdir(cursor);

      await sweepStaleMarkerDirs();

      // The run still did its work; only the rotation degrades.
      expect((await readdir(dir)).filter((n) => n.startsWith("eo-sandbox-selftest-"))).toEqual([]);

      // And the DEGRADED rotation still rotates. With the cursor permanently
      // unwritable every run takes the fallback, so a CONSTANT fallback is
      // round 27's starvation restored.
      //
      // The entries in front must be UNREMOVABLE. Seeded with removable ones a
      // constant offset still converges -- the window empties and the next run
      // sees new entries at the same index -- which is precisely the flaw round
      // 28 found in round 27's test, and which this assertion had at first.
      const { writeFile, chmod, utimes, access } = await import("node:fs/promises");
      const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
      for (let i = 0; i < SCAN_LIMIT + 20; i += 1) {
        const wall = join(dir, `eo-sandbox-selftest-W${String(i).padStart(5, "0")}`);
        await mkdir(wall);
        await writeFile(join(wall, "held"), "");
        await chmod(wall, 0o500);
        await utimes(wall, stale, stale);
      }
      // Sorts after the wall, so it lies beyond the first window.
      const victim = join(dir, "eo-sandbox-selftest-ZZZZZ");
      await mkdir(victim);
      await utimes(victim, stale, stale);

      // A constant fallback re-scans the same window forever and never reaches
      // it; an advancing one does, within a few calls.
      for (let call = 0; call < 4; call += 1) await sweepStaleMarkerDirs();
      await expect(access(victim)).rejects.toThrow();

      for (const name of await readdir(dir)) {
        await chmod(join(dir, name), 0o700).catch(() => undefined);
      }
    });
  });

  it.each([1.5, Number.NaN, -0.5, Number.POSITIVE_INFINITY])(
    "does not throw for a non-integer offset (%s)",
    async (offset) => {
      // `sweepStaleMarkerDirs` is on the public API surface. A non-integer index
      // made `entries[i]` undefined, and `join` threw -- from a call site
      // OUTSIDE `run()`'s try/finally, so the framework reported "check threw
      // unexpectedly" instead of a health verdict.
      await withTmpdir(async (dir) => {
        await seedStale(dir, 5);
        await expect(sweepStaleMarkerDirs(offset)).resolves.toBeUndefined();

        // And it must still SWEEP. Without the normalisation every index is
        // fractional, so every lookup is `undefined`, every iteration throws
        // into the catch, and the sweep silently does nothing at all -- which
        // no "did not throw" assertion can distinguish from working.
        const { readdir } = await import("node:fs/promises");
        expect((await readdir(dir)).filter((n) => n.startsWith("eo-sandbox-selftest-"))).toEqual(
          [],
        );
      });
    },
  );
});

/**
 * Roast round 30 — the anti-starvation cursor was a /tmp file, opened as one.
 *
 * Round 29 persisted the sweep cursor at
 * `$TMPDIR/.eo-sandbox-selftest-sweep-cursor`, deliberately NOT marker-prefixed
 * "so the sweep never deletes its own cursor" — which also means the sweep
 * never deletes anything an attacker plants there. `TMPDIR` is world-writable
 * and shared, and both ends of the cursor followed whatever was at that name.
 * Measured end-to-end through the BUNDLED CLI, not by reading:
 *
 *   ln -s ~/victim $TMPDIR/.eo-sandbox-selftest-sweep-cursor
 *   -> `crabgic doctor` exits 2, victim's contents replaced by "1785303771",
 *      and it reports `✓ sandbox.selftest: ... correctly denied` while doing it.
 *
 *   mkfifo $TMPDIR/.eo-sandbox-selftest-sweep-cursor
 *   -> `crabgic doctor` HANGS FOREVER: wall=25s, killed by an external timeout,
 *      0 bytes of output, no diagnosis. The identical staging without the FIFO
 *      finishes in 1s with 1198 bytes. `readFile` blocks in `open(2)` until a
 *      writer appears, and it is awaited from `createOwnedMarkerPath` ->
 *      `resolveMarker`, which runs BEFORE `run()`'s try/finally and carries no
 *      timeout of its own. That is round 22's property — "doctor must never
 *      hang" — on the line round 29 added.
 *
 * Two layers, and the second is not redundant with the first: the cursor moves
 * to `$XDG_STATE_HOME/crabgic/`, which no other account can write, AND both
 * ends open with `O_NOFOLLOW|O_NONBLOCK` and require a regular file this uid
 * owns — because `XDG_STATE_HOME` is itself environment-controlled and can be
 * pointed at a shared directory, and homes can be group-writable or on NFS.
 * The policy store learned this in round 4; the cursor had to learn it again.
 */
describe("sandbox-selftest — the sweep cursor is not attacker-plantable", () => {
  interface Stage {
    readonly tmp: string;
    readonly state: string;
  }

  async function withStage<T>(run: (stage: Stage) => Promise<T>): Promise<T> {
    const { mkdtemp, rm, mkdir, utimes } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "eo-r30-"));
    const tmp = join(root, "tmp");
    const state = join(root, "state");
    await mkdir(tmp);
    await mkdir(state);

    // One stale marker, so the sweep gets past its `entries.length === 0` guard
    // and actually consults the cursor. Without it every assertion below is
    // vacuous — the sweep returns before reading anything.
    const stale = join(tmp, "eo-sandbox-selftest-stale");
    await mkdir(stale);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(stale, old, old);

    const previousTmp = process.env["TMPDIR"];
    const previousState = process.env["XDG_STATE_HOME"];
    process.env["TMPDIR"] = tmp;
    process.env["XDG_STATE_HOME"] = state;
    try {
      return await run({ tmp, state });
    } finally {
      if (previousTmp === undefined) delete process.env["TMPDIR"];
      else process.env["TMPDIR"] = previousTmp;
      if (previousState === undefined) delete process.env["XDG_STATE_HOME"];
      else process.env["XDG_STATE_HOME"] = previousState;
      await rm(root, { recursive: true, force: true });
    }
  }

  /** The sweep must still do its job in every degraded case, or "no clobber" is satisfied by a no-op. */
  async function expectSwept(tmp: string): Promise<void> {
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(tmp)).filter((n) => n.startsWith("eo-sandbox-selftest-"))).toEqual([]);
  }

  it("writes no cursor into TMPDIR at all", async () => {
    const { readdir } = await import("node:fs/promises");
    await withStage(async ({ tmp }) => {
      await sweepStaleMarkerDirs();
      await expectSwept(tmp);

      // Not "no file named the old cursor" — NOTHING left in TMPDIR. The whole
      // attack class needs a predictable name in a world-writable directory,
      // and the fix is to stop creating one rather than to rename it.
      expect(await readdir(tmp)).toEqual([]);
    });
  });

  it("refuses to follow a symlink planted at the cursor path", async () => {
    const { readFile, writeFile, mkdir, symlink, lstat } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await withStage(async ({ tmp, state }) => {
      const victim = join(state, "victim");
      const ORIGINAL = "a file this uid owns and the cursor must never touch\n";
      await writeFile(victim, ORIGINAL);

      const cursor = sweepCursorPath() as string;
      await mkdir(dirname(cursor), { recursive: true });
      await symlink(victim, cursor);

      await sweepStaleMarkerDirs();

      expect(await readFile(victim, "utf8")).toBe(ORIGINAL);
      // Refused, not replaced: the check must not "fix" the path by unlinking
      // an attacker's symlink either, which would be a second write primitive.
      expect((await lstat(cursor)).isSymbolicLink()).toBe(true);
      await expectSwept(tmp);
    });
  });

  it("does not block on a FIFO at the cursor path", async () => {
    const { mkdir } = await import("node:fs/promises");
    const { execFileSync } = await import("node:child_process");
    await withStage(async ({ tmp }) => {
      const cursor = sweepCursorPath() as string;
      await mkdir(dirname(cursor), { recursive: true });
      execFileSync("mkfifo", [cursor]);

      // A FIFO with no writer blocks in `open(2)`. Racing a timer is the only
      // assertion that can fail on a hang — an `await` that never settles just
      // times the test out with no diagnosis, which is the very symptom.
      const settled = await Promise.race([
        sweepStaleMarkerDirs().then(() => true),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), 5_000);
        }),
      ]);

      expect(settled).toBe(true);
      await expectSwept(tmp);
    });
  }, 20_000);

  it("ignores a cursor that is not a regular file, and still sweeps", async () => {
    const { mkdir } = await import("node:fs/promises");
    await withStage(async ({ tmp }) => {
      const cursor = sweepCursorPath() as string;
      await mkdir(dirname(cursor), { recursive: true });
      await mkdir(cursor);

      await sweepStaleMarkerDirs();
      await expectSwept(tmp);
    });
  });

  it("creates its state directory unreadable by other accounts", async () => {
    const { stat } = await import("node:fs/promises");
    await withStage(async () => {
      await sweepStaleMarkerDirs();
      const cursor = sweepCursorPath() as string;
      expect((await stat(dirname(cursor))).mode & 0o077).toBe(0);
      expect((await stat(cursor)).mode & 0o077).toBe(0);
    });
  });

  it("falls back to the clock when no state home can be resolved", async () => {
    const { mkdtemp, mkdir, rm, utimes, readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmp = await mkdtemp(join(tmpdir(), "eo-r30-nohome-"));
    const previousTmp = process.env["TMPDIR"];
    const previousHome = process.env["HOME"];
    const previousState = process.env["XDG_STATE_HOME"];
    try {
      const stale = join(tmp, "eo-sandbox-selftest-stale");
      await mkdir(stale);
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await utimes(stale, old, old);

      process.env["TMPDIR"] = tmp;
      delete process.env["HOME"];
      delete process.env["XDG_STATE_HOME"];

      expect(sweepCursorPath()).toBeUndefined();
      // A sweep failure is never a health verdict, and an unresolvable state
      // home is not a reason to leave stale markers accumulating forever.
      await expect(sweepStaleMarkerDirs()).resolves.toBeUndefined();
      expect((await readdir(tmp)).filter((n) => n.startsWith("eo-sandbox-selftest-"))).toEqual([]);
    } finally {
      if (previousTmp === undefined) delete process.env["TMPDIR"];
      else process.env["TMPDIR"] = previousTmp;
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      if (previousState === undefined) delete process.env["XDG_STATE_HOME"];
      else process.env["XDG_STATE_HOME"] = previousState;
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
