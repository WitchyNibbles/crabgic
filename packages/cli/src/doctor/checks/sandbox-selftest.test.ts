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
  it("produces a verdict consistent with what the shell actually did", async () => {
    const { createRealProcessProbe } = await import("../process-probe.js");
    const probe = createRealProcessProbe();

    const presence = await probe("bwrap", ["--version"]).catch(() => undefined);
    if (presence === undefined || presence.exitCode !== 0) {
      // No bwrap here. Asserting anything would be an assertion of absence --
      // the exact defect this check exists to avoid making about itself.
      return;
    }

    const finding = await createSandboxSelftestCheck({ probe }).run();

    // Whatever the host does, the verdict must not contradict its own
    // evidence: a refusal quoted in stderr means the write WAS attempted.
    if (/read-only file system/i.test(finding.evidence)) {
      expect(finding.evidence).not.toContain("never reported running");
      expect(finding.passed).toBe(true);
    }
  });
});

/**
 * The marker's POSITION, asserted on the argv itself.
 *
 * No injected probe can distinguish `echo MARKER; write` from `write; echo
 * MARKER` -- both yield a marker on a host where the write is denied -- yet
 * the difference is the whole security property. Round 18 measured it against
 * real bwrap: with the marker first, a SIGKILL at 10ms, 50ms or 200ms
 * produced a false "correctly denied" 10 times out of 10, because the marker
 * lands ~1ms after spawn and proves only that a shell started.
 *
 * So the ordering is pinned where it actually lives.
 */
describe("sandbox-selftest — the marker must follow the write", () => {
  it("emits the marker after the write, carrying its exit status", async () => {
    let confinementArgs: readonly string[] = [];
    const check = createSandboxSelftestCheck({
      probe: async (_command, args) => {
        if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
        confinementArgs = args;
        return { stdout: "WROTE:1\n", stderr: "Read-only file system", exitCode: 1 };
      },
    });
    await check.run();

    const script = confinementArgs[confinementArgs.length - 1] ?? "";
    const writeAt = script.indexOf("> /eo-sandbox-selftest-marker");
    const markerAt = script.indexOf("WROTE:");

    expect(writeAt).toBeGreaterThanOrEqual(0);
    expect(markerAt).toBeGreaterThan(writeAt);
    // And it must carry the write's status, not a constant.
    expect(script).toContain("$?");
  });
});
