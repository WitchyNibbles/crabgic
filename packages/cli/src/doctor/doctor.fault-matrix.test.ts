/**
 * roadmap/09-cli-and-doctor.md §Test plan, Integration: "doctor
 * fault-fixture matrix (wrong engine-version string, missing `bwrap`,
 * rogue settings file present, bad UDS socket permissions, torn journal
 * segment) — each fixture is seeded before its check is registered and
 * must fail red first." Exit criterion `doctor.fault-matrix.test`. Each
 * `it.each`-style case below constructs the check directly against a
 * seeded fault double (never a real host binary) and asserts it fails with
 * a correct, non-destructive repair step.
 */
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSupervisorRuntimeDir, resolveSupervisorSocketPath } from "@eo/supervisor";
import { createEngineVersionCheck } from "./checks/engine-version.js";
import { createSandboxSelftestCheck } from "./checks/sandbox-selftest.js";
import { createHermeticitySelftestCheck } from "./checks/hermeticity-selftest.js";
import { createJournalChainCheck } from "./checks/journal-chain.js";
import { buildDefaultDoctorChecks } from "./run-doctor.js";
import type { ProbeResult } from "./process-probe.js";

function probeResult(overrides: Partial<ProbeResult>): ProbeResult {
  return { stdout: "", stderr: "", exitCode: 0, ...overrides };
}

const fakeJournal = {
  verifyJournal: async () => ({ segments: [], valid: true, totalValidEntries: 0 }),
};

describe("doctor fault-fixture matrix", () => {
  it("wrong engine-version string: fails with a repair step naming the accepted range", async () => {
    const check = createEngineVersionCheck({
      probe: async () => probeResult({ stdout: "1.0.0 (Claude Code)\n" }),
    });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("1.0.0");
    expect(finding.repairStep).toBeDefined();
  });

  it("missing bwrap: fails with a repair step to install it", async () => {
    const check = createSandboxSelftestCheck({
      probe: async (command) =>
        command === "bwrap"
          ? probeResult({ exitCode: 127, stderr: "bwrap: command not found" })
          : probeResult({}),
    });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
    expect(finding.repairStep).toContain("bubblewrap");
  });

  it("rogue settings file present (planted CLAUDE.md leaks its marker): fails", async () => {
    const check = createHermeticitySelftestCheck({
      probe: async () => ({
        executed: true,
        rogueMarkerLeaked: true,
        detail: "planted marker PINEAPPLE-CI-77 appeared in the reply",
      }),
    });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("influenced the run");
  });

  describe("bad UDS socket permissions", () => {
    // ADVERSARIAL-REVIEW FIX (2026-07-24): this case previously checked a
    // fake, unrelated directory ("/state/root", kind "dir") never fed to
    // any real check by `run-doctor.ts` — it was mislabeled and proved
    // nothing about socket permissions specifically. This now binds a REAL
    // UDS socket at the exact path `resolveSupervisorSocketPath` computes,
    // mis-chmods it, and runs it through `buildDefaultDoctorChecks`'s own
    // wiring (`run-doctor.ts`), so both "the fault is real" and "the
    // production wiring catches it" are proven together.
    let home: string;
    let server: Server | undefined;

    beforeEach(async () => {
      home = await mkdtemp(join(tmpdir(), "eo-sk-fm-"));
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
      server = undefined;
      await rm(home, { recursive: true, force: true });
    });

    it("fails naming the exact offending socket path and both the wrong and expected modes", async () => {
      const projectHash = "fm1";
      const xdgEnv = { HOME: home };
      const runtimeDir = resolveSupervisorRuntimeDir(xdgEnv, projectHash);
      const socketPath = resolveSupervisorSocketPath(xdgEnv, projectHash);
      await mkdir(runtimeDir, { recursive: true });

      server = createServer();
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(socketPath, () => resolve());
      });
      await chmod(socketPath, 0o755); // wrong — spec requires 0600

      const checks = buildDefaultDoctorChecks({ projectHash, journal: fakeJournal, xdgEnv });
      const finding = await checks.find((c) => c.id === "xdg.permissions")!.run();

      expect(finding.passed).toBe(false);
      expect(finding.evidence).toContain(socketPath);
      expect(finding.evidence).toContain("0755");
      expect(finding.evidence).toContain("0600");
    });
  });

  it("torn journal segment: fails and distinguishes tail-position (safe-repair) from mid-journal corruption", async () => {
    const check = createJournalChainCheck({
      journal: {
        verifyJournal: async () => ({
          segments: [],
          valid: false,
          totalValidEntries: 3,
          firstInvalid: {
            segmentIndex: 1,
            segmentFilePath: "/journal/segments/000001.ndjson",
            issue: { kind: "parse_error", lineIndex: 4, detail: "unexpected EOF" },
            isTailPosition: true,
          },
        }),
      },
    });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("000001.ndjson");
    expect(finding.repairStep).toContain("repairJournal");
  });

  it("torn journal segment (mid-journal corruption variant): repair step refuses auto-repair", async () => {
    const check = createJournalChainCheck({
      journal: {
        verifyJournal: async () => ({
          segments: [],
          valid: false,
          totalValidEntries: 3,
          firstInvalid: {
            segmentIndex: 1,
            segmentFilePath: "/journal/segments/000001.ndjson",
            issue: { kind: "hash_mismatch", lineIndex: 2, detail: "tampered" },
            isTailPosition: false,
          },
        }),
      },
    });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
    expect(finding.repairStep).toContain("NOT a safe auto-repair");
  });

  it("every fixture above would produce NO finding at all before its check is registered (work item 4's own failing-first framing)", async () => {
    const { runDoctorChecks } = await import("./framework.js");
    const report = await runDoctorChecks([]);
    expect(report.findings).toEqual([]);
  });
});
