import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeContentDigest } from "@eo/plugin";
import { writeInstallState, type InstallState } from "../../installer/state-store.js";
import { createCapabilityManifestFreshnessCheck } from "./capability-manifest-freshness.js";

const PLUGIN_ROOT = new URL("../../../../plugin", import.meta.url).pathname;

const dirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-manifest-freshness-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function stateWithDigest(digest: string): InstallState {
  return {
    schemaVersion: 1,
    installedAt: new Date(0).toISOString(),
    sourceVersion: "0.0.0",
    sourceDigest: digest,
    artifacts: [],
  };
}

describe("createCapabilityManifestFreshnessCheck", () => {
  it("passes gracefully when the project was never installed into", async () => {
    const dir = await makeTmpDir();
    const finding = await createCapabilityManifestFreshnessCheck({
      targetDir: dir,
      pluginSourceDir: PLUGIN_ROOT,
    }).run();
    expect(finding.passed).toBe(true);
  });

  it("passes when the recorded digest matches the current plugin source", async () => {
    const dir = await makeTmpDir();
    await writeInstallState(dir, stateWithDigest(computeContentDigest(PLUGIN_ROOT)));
    const finding = await createCapabilityManifestFreshnessCheck({
      targetDir: dir,
      pluginSourceDir: PLUGIN_ROOT,
    }).run();
    expect(finding.passed).toBe(true);
  });

  it("fails a seeded stale-digest fixture (work item 7's first-failing-test scenario, now caught)", async () => {
    const dir = await makeTmpDir();
    await writeInstallState(dir, stateWithDigest("0".repeat(64))); // deliberately wrong/stale
    const finding = await createCapabilityManifestFreshnessCheck({
      targetDir: dir,
      pluginSourceDir: PLUGIN_ROOT,
    }).run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("stale");
    expect(finding.repairStep).toContain("upgrade");
  });
});
