import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeChecksum } from "../../installer/checksum.js";
import { writeInstallState, type InstallState } from "../../installer/state-store.js";
import { createChecksumDriftCheck } from "./checksum-drift.js";

const dirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-checksum-drift-check-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("createChecksumDriftCheck", () => {
  it("passes gracefully when the project was never installed into", async () => {
    const dir = await makeTmpDir();
    const finding = await createChecksumDriftCheck({ targetDir: dir }).run();
    expect(finding.passed).toBe(true);
  });

  it("passes when every tracked artifact still matches its installed checksum", async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, "CLAUDE.md"), "content\n", "utf8");
    const state: InstallState = {
      schemaVersion: 1,
      installedAt: new Date(0).toISOString(),
      sourceVersion: "0.0.0",
      sourceDigest: "x",
      artifacts: [
        {
          relPath: "CLAUDE.md",
          kind: "merged",
          installedChecksum: computeChecksum("content\n"),
          sourceVersion: "0.0.0",
        },
      ],
    };
    await writeInstallState(dir, state);
    const finding = await createChecksumDriftCheck({ targetDir: dir }).run();
    expect(finding.passed).toBe(true);
  });

  it("fails and reports a non-destructive repair step when a seeded single-artifact mutation is present", async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, "CLAUDE.md"), "content\n", "utf8");
    const state: InstallState = {
      schemaVersion: 1,
      installedAt: new Date(0).toISOString(),
      sourceVersion: "0.0.0",
      sourceDigest: "x",
      artifacts: [
        {
          relPath: "CLAUDE.md",
          kind: "merged",
          installedChecksum: computeChecksum("content\n"),
          sourceVersion: "0.0.0",
        },
      ],
    };
    await writeInstallState(dir, state);
    await writeFile(join(dir, "CLAUDE.md"), "MUTATED content\n", "utf8");

    const finding = await createChecksumDriftCheck({ targetDir: dir }).run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("CLAUDE.md");
    expect(finding.repairStep).toBeDefined();
    expect(finding.repairStep).not.toMatch(/delete|remove|force/i);
  });
});
