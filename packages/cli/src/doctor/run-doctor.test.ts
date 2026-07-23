import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSupervisorRuntimeDir, resolveSupervisorSocketPath } from "@eo/supervisor";
import { buildDefaultDoctorChecks, runDoctor } from "./run-doctor.js";

const fakeJournal = {
  verifyJournal: async () => ({ segments: [], valid: true, totalValidEntries: 0 }),
};

describe("buildDefaultDoctorChecks", () => {
  it("wires every named doctor check exactly once", () => {
    const checks = buildDefaultDoctorChecks({ projectHash: "abc123", journal: fakeJournal });
    expect(checks.map((c) => c.id)).toEqual([
      "engine.version",
      "sandbox.selftest",
      "hermeticity.selftest",
      "auth.probe",
      "git.plumbing",
      "xdg.permissions",
      "journal.chain",
      "wsl2.warnings",
    ]);
  });
});

describe("runDoctor", () => {
  it("runs to completion against real (possibly-absent) host binaries without crashing", async () => {
    const report = await runDoctor({ projectHash: "abc123", journal: fakeJournal });
    expect(report.findings).toHaveLength(8);
    // Every finding is well-formed regardless of pass/fail.
    for (const finding of report.findings) {
      expect(typeof finding.passed).toBe("boolean");
      expect(finding.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe("buildDefaultDoctorChecks — real supervisor control socket permission wiring (adversarial-review fix, 2026-07-24)", () => {
  let home: string;
  let server: Server | undefined;

  beforeEach(async () => {
    // Kept deliberately short: AF_UNIX socket paths are capped at ~108 bytes
    // on Linux (`sun_path`), and this path nests
    // `.local/state/engineering-orchestrator/<hash>/supervisor/run/control.sock`
    // under it — a longer tmp prefix or project-hash here reproducibly hits
    // `EINVAL` on `listen()`.
    home = await mkdtemp(join(tmpdir(), "eo-sk-"));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
    await rm(home, { recursive: true, force: true });
  });

  it("the xdg.permissions check catches a real, mis-permissioned (0755) UDS control socket", async () => {
    const projectHash = "h1";
    const xdgEnv = { HOME: home };
    const runtimeDir = resolveSupervisorRuntimeDir(xdgEnv, projectHash);
    const socketPath = resolveSupervisorSocketPath(xdgEnv, projectHash);
    await mkdir(runtimeDir, { recursive: true });

    server = createServer();
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(socketPath, () => resolve());
    });
    // Deliberately WRONG mode — a real bind's default mode is wider than
    // 0600 anyway (verified empirically elsewhere in this repo), but make
    // the fault explicit and deterministic here.
    await chmod(socketPath, 0o755);

    const checks = buildDefaultDoctorChecks({ projectHash, journal: fakeJournal, xdgEnv });
    const xdgCheck = checks.find((c) => c.id === "xdg.permissions")!;
    const finding = await xdgCheck.run();

    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain(socketPath);
    expect(finding.evidence).toContain("0755");
    expect(finding.evidence).toContain("0600");
  });

  it("the xdg.permissions check passes when the real UDS control socket has the correct 0600 mode", async () => {
    const projectHash = "h2";
    const xdgEnv = { HOME: home };
    const runtimeDir = resolveSupervisorRuntimeDir(xdgEnv, projectHash);
    const socketPath = resolveSupervisorSocketPath(xdgEnv, projectHash);
    await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
    await chmod(runtimeDir, 0o700);

    server = createServer();
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(socketPath, () => resolve());
    });
    await chmod(socketPath, 0o600);

    const checks = buildDefaultDoctorChecks({ projectHash, journal: fakeJournal, xdgEnv });
    const xdgCheck = checks.find((c) => c.id === "xdg.permissions")!;
    const finding = await xdgCheck.run();

    expect(finding.passed).toBe(true);
  });
});
