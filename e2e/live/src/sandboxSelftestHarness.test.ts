import { describe, expect, it } from "vitest";
import type { ProcessProbeFn, ProbeResult } from "crabgic";
import { realSandboxProbe, runSandboxSelftest } from "./sandboxSelftestHarness.js";

function fakeProbe(
  responses: Readonly<Record<string, ProbeResult>>,
  fallback: ProbeResult,
): ProcessProbeFn {
  return async (command) => responses[command] ?? fallback;
}

describe("runSandboxSelftest — unit (fake probe, no real bwrap needed)", () => {
  it("fails when bwrap is not on PATH", async () => {
    const probe = fakeProbe({}, { stdout: "", stderr: "command not found", exitCode: 127 });
    const finding = await runSandboxSelftest(probe);
    expect(finding.passed).toBe(false);
    expect(finding.id).toBe("sandbox.selftest");
  });

  it("fails (not a vacuous pass) when bwrap itself fails to set up the sandbox (unprivileged userns disabled)", async () => {
    let call = 0;
    const probe: ProcessProbeFn = async () => {
      call += 1;
      if (call === 1) return { stdout: "bubblewrap 0.9.0", stderr: "", exitCode: 0 };
      return {
        stdout: "",
        stderr: "bwrap: creating new namespace failed",
        exitCode: 1,
      };
    };
    const finding = await runSandboxSelftest(probe);
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("UNVERIFIED");
  });

  it("fails when a confined write unexpectedly succeeds", async () => {
    let call = 0;
    const probe: ProcessProbeFn = async () => {
      call += 1;
      if (call === 1) return { stdout: "bubblewrap 0.9.0", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const finding = await runSandboxSelftest(probe);
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("unexpectedly succeeded");
  });

  /**
   * The `WROTE:` marker is load-bearing, and this fixture was stale without it.
   *
   * The check's own hardening rounds added an executed-call guard: a refusal
   * proves confinement only if the sandboxed shell demonstrably RAN, because a
   * signal-kill, an OOM or a fork failure all look like "the write was denied"
   * from the outside. The shell therefore echoes `WROTE:$?`, and a probe result
   * with empty stdout means the write was never attempted — `UNVERIFIED`, not
   * confirmed.
   *
   * This fake predated that guard and still returned empty stdout, so the check
   * correctly refused to pass and this test had been failing on `main`. It was
   * asserting the old contract, not a real defect: `packages/cli`'s own unit
   * test for the same check has used `WROTE:1\n` throughout. A non-zero suffix
   * is the passing shape — the write was attempted and failed.
   */
  it("passes when bwrap is present and correctly denies the confined write", async () => {
    let call = 0;
    const probe: ProcessProbeFn = async () => {
      call += 1;
      if (call === 1) return { stdout: "bubblewrap 0.9.0", stderr: "", exitCode: 0 };
      return { stdout: "WROTE:1\n", stderr: "sh: Read-only file system", exitCode: 1 };
    };
    const finding = await runSandboxSelftest(probe);
    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("correctly denied");
  });

  /**
   * The guard the fixture above had drifted past, asserted directly so this file
   * cannot silently fall behind the check again: a refusal with no marker is not
   * a pass.
   */
  it("fails when the refusal carries no evidence that the write was ever attempted", async () => {
    let call = 0;
    const probe: ProcessProbeFn = async () => {
      call += 1;
      if (call === 1) return { stdout: "bubblewrap 0.9.0", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "sh: Read-only file system", exitCode: 1 };
    };
    const finding = await runSandboxSelftest(probe);
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("UNVERIFIED");
  });
});

describe("runSandboxSelftest — genuine integration (real bwrap, no engine/auth needed)", () => {
  it("runs the real confinement self-test on this host and reports a well-formed finding", async () => {
    const finding = await runSandboxSelftest(realSandboxProbe());
    expect(finding.id).toBe("sandbox.selftest");
    expect(typeof finding.passed).toBe("boolean");
    expect(finding.evidence.length).toBeGreaterThan(0);
    // docs/engine-baseline.md records bwrap 0.9.0 present on the baseline
    // host; this repeats that self-test for real, on whatever host this
    // release-hardening harness runs on.
    expect(finding.passed).toBe(true);
  });
});
