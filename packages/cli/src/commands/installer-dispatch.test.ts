/**
 * `dispatchCommand`'s conditional routing for `install`/`upgrade`/
 * `uninstall` (roadmap/10-plugin-and-installer.md) — when `deps.installer`
 * IS supplied, these three commands hit the real backend rather than
 * `NOT_IMPLEMENTED`. `./cli.commands.schema.test.ts`'s own suite (09,
 * unmodified by this phase) proves the OTHER half: without `deps.installer`
 * they still return the exact typed `NOT_IMPLEMENTED` shape.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_OK } from "../exit-codes.js";
import { dispatchCommand } from "./dispatch.js";
import type { CliDependencies } from "./types.js";

const PLUGIN_ROOT = new URL("../../../plugin", import.meta.url).pathname;

const dirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-installer-dispatch-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function baseDeps(): Pick<CliDependencies, "connectClient" | "journal" | "projectHash"> {
  return {
    connectClient: () => {
      throw new Error("not needed for this test");
    },
    journal: {
      queryEntries: async function* () {
        /* no entries */
      },
      verifyJournal: async () => ({ ok: true, entries: 0 }) as never,
    },
    projectHash: "test-hash",
  };
}

describe("dispatchCommand — install/upgrade/uninstall, real backend when deps.installer is supplied", () => {
  it("install --json actually installs when deps.installer is present", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    const result = await dispatchCommand({ command: "install", dryRun: false, json: true }, deps);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(existsSync(join(targetDir, "CLAUDE.md"))).toBe(true);
    const parsed = JSON.parse(result.stdout!) as { status: string };
    expect(parsed.status).toBe("installed");
  });

  it("upgrade --json runs the real upgrade backend when deps.installer is present", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    await dispatchCommand({ command: "install", dryRun: false, json: true }, deps);
    const result = await dispatchCommand({ command: "upgrade", dryRun: false, json: true }, deps);
    expect(result.exitCode).toBe(EXIT_OK);
    const parsed = JSON.parse(result.stdout!) as { status: string };
    expect(parsed.status).toBe("up-to-date");
  });

  it("uninstall --json runs the real uninstall backend when deps.installer is present", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    await dispatchCommand({ command: "install", dryRun: false, json: true }, deps);
    const result = await dispatchCommand(
      { command: "uninstall", keepState: false, json: true },
      deps,
    );
    expect(result.exitCode).toBe(EXIT_OK);
    const parsed = JSON.parse(result.stdout!) as { status: string };
    expect(parsed.status).toBe("uninstalled");
  });

  it("install (non-json) renders a human-readable diff summary", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    const result = await dispatchCommand({ command: "install", dryRun: false, json: false }, deps);
    expect(result.stdout).toContain("install:");
    expect(result.stdout).toContain("CLAUDE.md");
  });

  it("upgrade (non-json) renders a human-readable diff summary, including an updated (~) entry", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    await dispatchCommand({ command: "install", dryRun: false, json: true }, deps);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(targetDir, "CLAUDE.md"), "drifted, forces an update line\n", "utf8");

    const result = await dispatchCommand({ command: "upgrade", dryRun: false, json: false }, deps);
    expect(result.stdout).toContain("upgrade:");
    expect(result.stdout).toContain("~ CLAUDE.md");
  });

  it("upgrade (non-json) mentions recovery when a prior interrupted upgrade is reconciled", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    await dispatchCommand({ command: "install", dryRun: false, json: true }, deps);
    const { readFile, writeFile } = await import("node:fs/promises");
    const { backupArtifact, writeUpgradeMarker } = await import("../installer/state-store.js");
    const original = await readFile(join(targetDir, "CLAUDE.md"), "utf8");
    const backupPath = await backupArtifact(targetDir, "CLAUDE.md", original);
    await writeUpgradeMarker(targetDir, [
      {
        relPath: "CLAUDE.md",
        kind: "merged",
        installedChecksum: "",
        sourceVersion: "",
        ...(backupPath ? { backupPath } : {}),
      },
    ]);
    await writeFile(join(targetDir, "CLAUDE.md"), "TORN", "utf8");

    const result = await dispatchCommand({ command: "upgrade", dryRun: false, json: false }, deps);
    expect(result.stdout).toContain("recovered a prior interrupted upgrade");
  });

  it("uninstall (non-json) renders a human-readable outcome summary", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    await dispatchCommand({ command: "install", dryRun: false, json: true }, deps);
    const result = await dispatchCommand(
      { command: "uninstall", keepState: false, json: false },
      deps,
    );
    expect(result.stdout).toContain("uninstall:");
    expect(result.stdout).toContain("CLAUDE.md");
  });
});

describe("dispatchCommand — doctor registers roadmap/10's 3 checks only when deps.installer is present", () => {
  it("doctor --json reports 13 findings (09's 10 + this phase's 3) when deps.installer is supplied", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    const result = await dispatchCommand(
      { command: "doctor", repairPlan: false, json: true },
      deps,
    );
    const parsed = JSON.parse(result.stdout!) as { findings: readonly unknown[] };
    expect(parsed.findings).toHaveLength(13);
  });

  it("doctor --json still reports exactly 10 findings when deps.installer is absent (09's baseline + the head-anchor check)", async () => {
    const deps: CliDependencies = baseDeps() as CliDependencies;
    const result = await dispatchCommand(
      { command: "doctor", repairPlan: false, json: true },
      deps,
    );
    const parsed = JSON.parse(result.stdout!) as { findings: readonly unknown[] };
    expect(parsed.findings).toHaveLength(10);
  });
});

/**
 * The install command's rendered POLICY lines (review S3 — the renderer
 * strings were the one untested surface of the existing-policy guard). What
 * the operator reads IS the guard's product: a kept policy that renders
 * nothing would look exactly like the silent clobber it replaced.
 */
describe("dispatchCommand — install renders the existing-policy outcomes", () => {
  const POLICY_BAG_BASE = {
    derive: () => {
      throw new Error("derive must not run when a policy exists");
    },
    confirm: () => {
      throw new Error("confirm must not run when a policy exists");
    },
    write: () => {
      throw new Error("write must not run when a policy exists");
    },
  };

  it("kept-existing: says the file was kept and how to re-author", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...(baseDeps() as CliDependencies),
      installer: {
        targetDir,
        pluginSourceDir: PLUGIN_ROOT,
        confirmGitInit: async () => true,
        policy: {
          ...POLICY_BAG_BASE,
          path: join(targetDir, "policy.json"),
          loadExisting: () => ({
            status: "loaded" as const,
            policy: {} as never,
            digest: "sha256:x",
          }),
        },
      },
    };
    const result = await dispatchCommand({ command: "install", dryRun: false, json: false }, deps);
    expect(result.stdout).toContain("standing policy already exists and was kept untouched");
    expect(result.stdout).toContain("delete it and re-run `crabgic install` to re-author");
  });

  it("existing-invalid, transient: the remedy agrees with the evidence — retry, never delete", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...(baseDeps() as CliDependencies),
      installer: {
        targetDir,
        pluginSourceDir: PLUGIN_ROOT,
        confirmGitInit: async () => true,
        policy: {
          ...POLICY_BAG_BASE,
          path: join(targetDir, "policy.json"),
          loadExisting: () => ({
            status: "invalid" as const,
            reason: "too many open files",
            transient: true,
          }),
        },
      },
    };
    const result = await dispatchCommand({ command: "install", dryRun: false, json: false }, deps);
    expect(result.stdout).toContain("could not be read right now");
    expect(result.stdout).toContain("do NOT delete it");
    expect(result.stdout).not.toContain("fix it by hand");
  });

  it("existing-invalid, genuine: fix by hand or delete-and-reinstall", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...(baseDeps() as CliDependencies),
      installer: {
        targetDir,
        pluginSourceDir: PLUGIN_ROOT,
        confirmGitInit: async () => true,
        policy: {
          ...POLICY_BAG_BASE,
          path: join(targetDir, "policy.json"),
          loadExisting: () => ({ status: "invalid" as const, reason: "not valid JSON" }),
        },
      },
    };
    const result = await dispatchCommand({ command: "install", dryRun: false, json: false }, deps);
    expect(result.stdout).toContain("cannot be loaded (not valid JSON)");
    expect(result.stdout).toContain("fix it by hand, or delete it and re-run");
  });
});
