import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeChecksum } from "./checksum.js";
import { runUninstall } from "./uninstall.js";
import { readInstallState, writeInstallState, type InstallState } from "./state-store.js";

const dirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-uninstall-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function seedFreshInstall(dir: string): Promise<void> {
  // CLAUDE.md: brand-new (no originalContent — did not exist pre-install).
  await writeFile(join(dir, "CLAUDE.md"), "# Managed\n", "utf8");
  // settings.json: pre-existed with a user key we merged additively into.
  await mkdir(join(dir, ".claude"), { recursive: true });
  const settingsContent = '{"userKey":true,"attribution":{"commit":"","pr":""}}\n';
  await writeFile(join(dir, ".claude", "settings.json"), settingsContent, "utf8");
  // Fully-owned agent file.
  await mkdir(join(dir, ".claude", "agents"), { recursive: true });
  await writeFile(
    join(dir, ".claude", "agents", "eo-explore.md"),
    "---\nname: eo-explore\n---\n",
    "utf8",
  );

  const state: InstallState = {
    schemaVersion: 1,
    installedAt: new Date(0).toISOString(),
    sourceVersion: "0.0.0",
    sourceDigest: "irrelevant",
    artifacts: [
      {
        relPath: "CLAUDE.md",
        kind: "merged",
        installedChecksum: computeChecksum("# Managed\n"),
        sourceVersion: "0.0.0",
      },
      {
        relPath: join(".claude", "settings.json"),
        kind: "merged",
        installedChecksum: computeChecksum(settingsContent),
        sourceVersion: "0.0.0",
        originalContent: '{"userKey":true}\n',
      },
      {
        relPath: join(".claude", "agents", "eo-explore.md"),
        kind: "full",
        installedChecksum: computeChecksum("---\nname: eo-explore\n---\n"),
        sourceVersion: "0.0.0",
      },
    ],
  };
  await writeInstallState(dir, state);
}

describe("runUninstall", () => {
  it('reports "not-installed" when there is no install state at all', async () => {
    const dir = await makeTmpDir();
    const result = await runUninstall(dir, { keepState: false });
    expect(result.status).toBe("not-installed");
  });

  it("deletes a fully-owned file that has not been edited since install", async () => {
    const dir = await makeTmpDir();
    await seedFreshInstall(dir);
    const result = await runUninstall(dir, { keepState: false });
    const explore = result.outcomes.find((o) => o.relPath.endsWith("eo-explore.md"));
    expect(explore?.action).toBe("removed");
    expect(existsSync(join(dir, ".claude", "agents", "eo-explore.md"))).toBe(false);
  });

  it("deletes a merged file that did not exist before install (no originalContent)", async () => {
    const dir = await makeTmpDir();
    await seedFreshInstall(dir);
    const result = await runUninstall(dir, { keepState: false });
    const claudeMd = result.outcomes.find((o) => o.relPath === "CLAUDE.md");
    expect(claudeMd?.action).toBe("removed");
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
  });

  it("restores a merged file's pre-install originalContent, preserving the user's own pre-existing key", async () => {
    const dir = await makeTmpDir();
    await seedFreshInstall(dir);
    const result = await runUninstall(dir, { keepState: false });
    const settings = result.outcomes.find((o) => o.relPath.endsWith("settings.json"));
    expect(settings?.action).toBe("restored");
    const restored = await readFile(join(dir, ".claude", "settings.json"), "utf8");
    expect(JSON.parse(restored)).toEqual({ userKey: true });
  });

  it("preserves a user edit made after install — never overwrites/deletes a drifted artifact (work item 6's first-failing-test scenario, now fixed)", async () => {
    const dir = await makeTmpDir();
    await seedFreshInstall(dir);
    // Simulate a user edit to the fully-owned agent file after install.
    await writeFile(
      join(dir, ".claude", "agents", "eo-explore.md"),
      "user's own edited content\n",
      "utf8",
    );

    const result = await runUninstall(dir, { keepState: false });
    const explore = result.outcomes.find((o) => o.relPath.endsWith("eo-explore.md"));
    expect(explore?.action).toBe("preserved-drifted");
    expect(await readFile(join(dir, ".claude", "agents", "eo-explore.md"), "utf8")).toBe(
      "user's own edited content\n",
    );
  });

  it("removes the state store by default", async () => {
    const dir = await makeTmpDir();
    await seedFreshInstall(dir);
    await runUninstall(dir, { keepState: false });
    expect(await readInstallState(dir)).toBeUndefined();
  });

  it("keeps the state store when --keep-state is set", async () => {
    const dir = await makeTmpDir();
    await seedFreshInstall(dir);
    await runUninstall(dir, { keepState: true });
    expect(await readInstallState(dir)).toBeDefined();
  });

  it("reports already-absent for an artifact whose file was manually deleted before uninstall ran", async () => {
    const dir = await makeTmpDir();
    await seedFreshInstall(dir);
    await rm(join(dir, ".claude", "agents", "eo-explore.md"));
    const result = await runUninstall(dir, { keepState: false });
    const explore = result.outcomes.find((o) => o.relPath.endsWith("eo-explore.md"));
    expect(explore?.action).toBe("already-absent");
  });
});
