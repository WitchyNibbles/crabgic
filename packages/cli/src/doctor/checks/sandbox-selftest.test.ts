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

    const script = confinementArgs[confinementArgs.length - 1] ?? "";
    const writeAt = script.indexOf("> /owned/marker");
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
    expect(script).toBe('echo x > /owned/marker; s=$?; echo "WROTE:$s"; exit $s');

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
    await createSandboxSelftestCheck({
      probe: async (_command, args) => {
        if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
        script = args[args.length - 1] ?? "";
        return { stdout: "WROTE:2\n", stderr: "Read-only file system", exitCode: 2 };
      },
    }).run();

    // Not `/`: a write there is refused by ordinary permissions, so it
    // measures nothing about the sandbox.
    expect(script).not.toContain("> /eo-sandbox-selftest-marker");
    const target = /> (\S+);/.exec(script)?.[1] ?? "";
    expect(target.split("/").length).toBeGreaterThan(2);

    // And it must really exist and be writable, or the probe would be
    // refused for the wrong reason again.
    const { access, constants } = await import("node:fs/promises");
    await expect(access(target, constants.W_OK)).resolves.toBeUndefined();
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
