import { describe, expect, it } from "vitest";
import { createSandboxSelftestCheck } from "./sandbox-selftest.js";

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
  it("PASSES on a host whose sandbox genuinely denies the write", async () => {
    const { createRealProcessProbe } = await import("../process-probe.js");
    const probe = createRealProcessProbe();

    const presence = await probe("bwrap", ["--version"]).catch(() => undefined);
    if (presence === undefined || presence.exitCode !== 0) return; // no bwrap here

    const finding = await createSandboxSelftestCheck({ probe }).run();

    // ROUND 19: the previous version of this test guarded on
    // /read-only file system/ against the EVIDENCE -- a string the PASS
    // branch never contains -- so zero assertions ever executed while the
    // check returned a flatly false verdict on this very host. A test that
    // cannot fire is worse than none.
    //
    // Asserted unconditionally instead: on a host with a working bwrap the
    // write must be refused and the check must say so.
    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("correctly denied");
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
