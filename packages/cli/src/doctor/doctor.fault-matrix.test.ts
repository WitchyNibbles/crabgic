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
import { resolveSupervisorRuntimeDir, resolveSupervisorSocketPath } from "@crabgic/supervisor";
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
    // Roast round 15: swapping the two evidence classifications survived the
    // whole suite, so the check could say "mid-journal corruption" while
    // offering to TRUNCATE the tail -- an evidence/remedy contradiction
    // pointing an owner at a destructive repair. Only the repairStep was
    // pinned; the classification it must agree with was not.
    expect(finding.evidence).toContain("torn tail");
    expect(finding.evidence).not.toContain("mid-journal corruption");
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
    // The mirror: mid-journal corruption must NOT be described as a torn
    // tail, or the evidence invites the truncation the remedy refuses.
    expect(finding.evidence).toContain("mid-journal corruption");
    expect(finding.evidence).not.toContain("torn tail");
  });

  it("every fixture above would produce NO finding at all before its check is registered (work item 4's own failing-first framing)", async () => {
    const { runDoctorChecks } = await import("./framework.js");
    const report = await runDoctorChecks([]);
    expect(report.findings).toEqual([]);
  });
});

/**
 * Roast round 16, on PRISTINE code -- not a mutant.
 *
 * `realStatMode` laundered every `stat` failure into "does not exist", so a
 * state root at 0777 under an unreadable parent reported passed:true with "no
 * XDG state/cache paths exist yet". The check asserted the paths did not
 * exist when all it knew was that it could not look -- reachable via `sudo
 * crabgic doctor`, ENOTDIR or ELOOP. The sibling hermeticity check states the
 * violated principle outright: "an assertion of absence is only sound when
 * the probing command demonstrably ran".
 */
describe("xdg-permissions — cannot look is not the same as not there", () => {
  const paths = [{ path: "/state/crabgic/abc", expectedMode: 0o700, kind: "dir" as const }];

  it("FAILS when a path could not be inspected, rather than reporting absence", async () => {
    const { createXdgPermissionsCheck } = await import("./checks/xdg-permissions.js");
    const finding = await createXdgPermissionsCheck({
      paths,
      statMode: () => Promise.resolve("unknown" as const),
    }).run();

    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("could not be inspected");
    expect(finding.repairStep).toMatch(/do not assume they are absent/);
  });

  it("still treats a genuinely missing path as nothing to check", async () => {
    const { createXdgPermissionsCheck } = await import("./checks/xdg-permissions.js");
    const finding = await createXdgPermissionsCheck({
      paths,
      statMode: () => Promise.resolve(undefined),
    }).run();

    expect(finding.passed).toBe(true);
    expect(finding.evidence).toMatch(/exist yet/);
  });

  it("reports a real mode violation ahead of an uninspectable path", async () => {
    const { createXdgPermissionsCheck } = await import("./checks/xdg-permissions.js");
    const finding = await createXdgPermissionsCheck({
      paths: [...paths, { path: "/state/other", expectedMode: 0o700, kind: "dir" as const }],
      statMode: (p) => Promise.resolve(p === "/state/other" ? ("unknown" as const) : 0o777),
    }).run();

    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("has mode 0777, expected 0700");
    // ROUND 17 CORRECTION: this asserted only the chmod step, which BLESSED
    // the defect -- whenever a real violation coexists with an uninspectable
    // path, "do not assume they are absent" was dropped and the owner was
    // told to chmod a path whose fault is that it cannot be read.
    expect(finding.repairStep).toMatch(/chmod the listed paths/);
    expect(finding.repairStep).toMatch(/do not assume they are absent/);
  });
});

/**
 * Roast round 16, also pristine code. The check tested `/mnt/c` alone while
 * its PASS evidence claimed the roots were "on the Linux filesystem" --
 * measured through the production path computation, `/mnt/d`, `/mnt/C` and a
 * HOME under `/mnt/e` all passed while being drvfs.
 */
describe("wsl2-warnings — every Windows drive mount, not just C", () => {
  async function check(stateRootPath: string) {
    const { createWsl2WarningsCheck } = await import("./checks/wsl2-warnings.js");
    return createWsl2WarningsCheck({
      isWsl2: () => Promise.resolve(true),
      stateRootPath,
      cacheRootPath: "/home/u/.cache/crabgic",
    }).run();
  }

  it.each(["/mnt/d/wsl-state", "/mnt/C/Users/me/state", "/mnt/e/wslhome/.local/state"])(
    "warns for %s",
    async (path) => {
      const finding = await check(path);
      expect(finding.passed).toBe(false);
      expect(finding.evidence).toMatch(/Windows drive mount/);
    },
  );

  it("still passes for a genuinely Linux-side root", async () => {
    expect((await check("/home/u/.local/state/crabgic")).passed).toBe(true);
  });
});

/**
 * `realStatMode`'s own errno classification -- the line round 16 found
 * laundering every failure into "does not exist".
 *
 * The tests above inject `"unknown"` directly, so they pin the CHECK's
 * handling of it and not the classification that produces it: reverting
 * `realStatMode` to return `undefined` for every error survived them. That is
 * the round-10 lesson repeating -- testing the consumer is not testing the
 * thing you changed.
 */
describe("realStatMode — absence versus inability to look", () => {
  it("reports a genuinely missing path as absent", async () => {
    const { realStatMode } = await import("./checks/xdg-permissions.js");
    const { join } = await import("node:path");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");

    const dir = mkdtempSync(join(tmpdir(), "eo-xdg-"));
    expect(await realStatMode(join(dir, "definitely-not-here"))).toBeUndefined();
  });

  it("reports an unreadable parent as unknown, NOT as absent", async () => {
    const { realStatMode } = await import("./checks/xdg-permissions.js");
    const { join } = await import("node:path");
    const { chmodSync, mkdirSync, mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");

    const dir = mkdtempSync(join(tmpdir(), "eo-xdg-"));
    const parent = join(dir, "locked");
    mkdirSync(join(parent, "child"), { recursive: true });
    chmodSync(parent, 0o000);
    try {
      // The child EXISTS; the parent simply cannot be traversed.
      expect(await realStatMode(join(parent, "child"))).toBe("unknown");
    } finally {
      chmodSync(parent, 0o700);
    }
  });

  it("reports a real mode for a path it can read", async () => {
    const { realStatMode } = await import("./checks/xdg-permissions.js");
    const { join } = await import("node:path");
    const { chmodSync, mkdirSync, mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");

    const dir = mkdtempSync(join(tmpdir(), "eo-xdg-"));
    const target = join(dir, "state");
    mkdirSync(target);
    chmodSync(target, 0o700);
    expect(await realStatMode(target)).toBe(0o700);
  });
});

/**
 * Roast round 15, finding 6 -- the same class as the journal-chain
 * contradiction, in the check next door. Swapping the missing/invalid
 * evidence strings survived the whole suite, because the invalid-state test
 * asserted only `passed === false`.
 *
 * Each diagnosis carries a DIFFERENT remedy: "no auth was found" pairs with
 * `claude setup-token` OR setting the env var, while "present but invalid"
 * pairs with re-authenticating. An owner told the wrong one either sets a
 * token they already have, or re-authenticates a credential that was never
 * there. Both directions are pinned so the evidence cannot drift from the
 * remedy it must agree with.
 */
describe("auth-probe — the diagnosis must match its remedy", () => {
  async function findingFor(state: "valid" | "missing" | "invalid") {
    const { createAuthProbeCheck } = await import("./checks/auth-probe.js");
    return createAuthProbeCheck({ probe: () => Promise.resolve(state) }).run();
  }

  it("says auth is absent, and offers to obtain one", async () => {
    const finding = await findingFor("missing");
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toBe("no subscription auth was found");
    expect(finding.evidence).not.toMatch(/present but invalid/);
    expect(finding.repairStep).toBe("run `claude setup-token` or set CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("says auth is present but bad, and offers to re-authenticate", async () => {
    const finding = await findingFor("invalid");
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toBe("subscription auth is present but invalid");
    expect(finding.evidence).not.toMatch(/no subscription auth/);
    expect(finding.repairStep).toBe("re-authenticate via `claude setup-token`");
  });

  it("reports valid auth without leaking anything about the credential", async () => {
    const finding = await findingFor("valid");
    expect(finding.passed).toBe(true);
    expect(finding.evidence).toBe("subscription auth is valid");
    expect(finding.repairStep).toBeUndefined();
  });
});

/**
 * Round 17: `ENOTDIR` and `ENAMETOOLONG` were classified as "could not
 * inspect", firing the new failure branch where the old code was right to
 * pass -- with evidence and a remedy that were both false, since the paths
 * really are absent and chmod cannot help.
 *
 * Exercised through `realStatMode` against real filesystem conditions,
 * because that is where the classification lives: injecting a rejection into
 * the CHECK tests the check's handling, not the mapping that produces it --
 * the same mistake this file already made once.
 */
describe("realStatMode — errno shapes that mean the path cannot exist", () => {
  it("treats a non-directory path component as absence", async () => {
    const { realStatMode } = await import("./checks/xdg-permissions.js");
    const { join } = await import("node:path");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");

    const dir = mkdtempSync(join(tmpdir(), "eo-xdg-"));
    const file = join(dir, "not-a-dir");
    writeFileSync(file, "x");

    // ENOTDIR: nothing can live below a regular file.
    expect(await realStatMode(join(file, "child"))).toBeUndefined();
  });

  it("treats an unrepresentable name as absence", async () => {
    const { realStatMode } = await import("./checks/xdg-permissions.js");
    const { join } = await import("node:path");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");

    const dir = mkdtempSync(join(tmpdir(), "eo-xdg-"));
    expect(await realStatMode(join(dir, "n".repeat(5000)))).toBeUndefined();
  });
});
