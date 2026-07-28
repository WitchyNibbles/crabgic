import { describe, expect, it } from "vitest";
import { createSandboxSelftestCheck } from "./sandbox-selftest.js";

describe("createSandboxSelftestCheck", () => {
  it("passes when bwrap is present and confinement holds (write denied)", async () => {
    const check = createSandboxSelftestCheck({
      probe: async (_command, args) => {
        if (args.includes("--version")) return { stdout: "bwrap 0.9.0", stderr: "", exitCode: 0 };
        return { stdout: "RAN\n", stderr: "Permission denied", exitCode: 1 };
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
          stdout: "RAN\n",
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
  ])("reports %s as UNVERIFIED, never as a passing sandbox", async (_name, result) => {
    const finding = await probeYielding(result).run();

    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("never reported running");
    expect(finding.evidence).not.toContain("correctly denied");
    expect(finding.repairStep).toMatch(/do not treat this as a passing sandbox/);
  });

  it("still passes when the shell proves it ran and the write was refused", async () => {
    const finding = await probeYielding({
      stdout: "RAN\n",
      stderr: "sh: 1: cannot create /eo-sandbox-selftest-marker: Read-only file system",
      exitCode: 1,
    }).run();

    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("correctly denied");
  });
});
