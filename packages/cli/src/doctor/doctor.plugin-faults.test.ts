/**
 * roadmap/10-plugin-and-installer.md exit criterion, suite
 * `doctor.plugin-faults.test`: "Doctor reports each seeded plugin/installer
 * fault (drift, unpinned source, stale digest) with a non-destructive
 * repair plan." Registers this phase's three new checks into 09's own
 * `runDoctorChecks`/`buildRepairPlan` framework (`./framework.ts`) and
 * seeds all three faults at once.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeChecksum } from "../installer/checksum.js";
import { writeInstallState, type InstallState } from "../installer/state-store.js";
import { createCapabilityManifestFreshnessCheck } from "./checks/capability-manifest-freshness.js";
import { createChecksumDriftCheck } from "./checks/checksum-drift.js";
import { createPluginTrustPinCheck } from "./checks/plugin-trust-pin.js";
import { buildRepairPlan, runDoctorChecks } from "./framework.js";

const dirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-doctor-plugin-faults-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function seedMarketplace(pluginSourceDir: string, commit: string): Promise<void> {
  await mkdir(join(pluginSourceDir, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(pluginSourceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
      name: "m",
      description: "d",
      owner: { name: "o", email: "o@example.invalid" },
      plugins: [
        {
          name: "crabgic",
          source: "./",
          description: "d",
          version: "0.0.0",
          license: "Apache-2.0",
          commit,
          digest: "irrelevant",
        },
      ],
    }),
    "utf8",
  );
}

describe("doctor.plugin-faults.test — all three seeded faults are reported with non-destructive repair steps", () => {
  it("reports drift, an unpinned plugin source, and a stale CapabilityManifest digest simultaneously", async () => {
    const targetDir = await makeTmpDir();
    const pluginSourceDir = await makeTmpDir();
    await seedMarketplace(pluginSourceDir, "main"); // unpinned branch ref — the seeded fault

    // Seed drift: a tracked artifact whose on-disk content no longer
    // matches its recorded checksum.
    await writeFile(join(targetDir, "CLAUDE.md"), "content\n", "utf8");
    const state: InstallState = {
      schemaVersion: 1,
      installedAt: new Date(0).toISOString(),
      sourceVersion: "0.0.0",
      // Seed a stale CapabilityManifest digest too (deliberately wrong).
      sourceDigest: "0".repeat(64),
      artifacts: [
        {
          relPath: "CLAUDE.md",
          kind: "merged",
          installedChecksum: computeChecksum("content\n"),
          sourceVersion: "0.0.0",
        },
      ],
    };
    await writeInstallState(targetDir, state);
    await writeFile(join(targetDir, "CLAUDE.md"), "DRIFTED content\n", "utf8"); // mutate after recording state

    const checks = [
      createChecksumDriftCheck({ targetDir }),
      createPluginTrustPinCheck({ pluginSourceDir }),
      createCapabilityManifestFreshnessCheck({ targetDir, pluginSourceDir }),
    ];

    const report = await runDoctorChecks(checks);
    expect(report.allPassed).toBe(false);

    const byId = Object.fromEntries(report.findings.map((f) => [f.id, f]));
    expect(byId["installer.checksum-drift"]?.passed).toBe(false);
    expect(byId["installer.plugin-trust-pin"]?.passed).toBe(false);
    expect(byId["installer.capability-manifest-freshness"]?.passed).toBe(false);

    const repairPlan = buildRepairPlan(report);
    expect(repairPlan).toHaveLength(3);
    // Non-destructive: never auto-executed, and never suggests a destructive verb.
    for (const step of repairPlan) {
      expect(step).not.toMatch(/\bdelete\b|\bforce\b|\brm -rf\b/i);
    }
  });

  it("reports all-clear when none of the three faults are present", async () => {
    const targetDir = await makeTmpDir();
    // A SEEDED, genuinely SHA-pinned plugin source. This deliberately no
    // longer points at the real `packages/plugin` directory: that listing's
    // `commit` is still git's all-zero null object ID (an unpinned
    // placeholder), which `MarketplaceSchema` now rejects — so the real
    // directory does have a fault today, and asserting otherwise here would
    // restate the falsehood `packages/plugin/src/marketplace-schema.test.ts`
    // was just corrected for. The fault-free case is what this test is for.
    const pluginSourceDir = await makeTmpDir();
    await seedMarketplace(pluginSourceDir, "a".repeat(40));

    const checks = [
      createChecksumDriftCheck({ targetDir }),
      createPluginTrustPinCheck({ pluginSourceDir }),
      createCapabilityManifestFreshnessCheck({ targetDir, pluginSourceDir }),
    ];
    const report = await runDoctorChecks(checks);
    expect(report.allPassed).toBe(true);
    expect(buildRepairPlan(report)).toEqual([]);
  });

  it("runs the FULL check set against the REAL packages/plugin source and reports exactly one fault: the unpinned entry", async () => {
    // The seeded all-clear case above keeps the fault-free shape under test,
    // but it stopped exercising the real, shipped plugin source. This case
    // puts it back, and pins the whole verdict rather than one check's:
    // today the real directory has EXACTLY ONE fault — its marketplace entry
    // is still git's all-zero null object ID — and the other two checks pass
    // against it. When the owner pins the entry at the release commit this
    // test flips to all-clear by DELETING nothing: the expectations below
    // describe the fault, so the assertion that must then change is the one
    // that names it, which is the point.
    const targetDir = await makeTmpDir();
    const realPluginSourceDir = new URL("../../../plugin", import.meta.url).pathname;

    const report = await runDoctorChecks([
      createChecksumDriftCheck({ targetDir }),
      createPluginTrustPinCheck({ pluginSourceDir: realPluginSourceDir }),
      createCapabilityManifestFreshnessCheck({ targetDir, pluginSourceDir: realPluginSourceDir }),
    ]);

    expect(report.allPassed).toBe(false);
    const failed = report.findings.filter((f) => !f.passed).map((f) => f.id);
    expect(failed).toEqual(["installer.plugin-trust-pin"]);
    expect(buildRepairPlan(report)).toHaveLength(1);
  });
});
