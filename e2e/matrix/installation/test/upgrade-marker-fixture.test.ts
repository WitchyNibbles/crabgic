import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildEmptyDir } from "../src/fixtures.js";
import {
  backupDir,
  seedInterruptedUpgrade,
  upgradeMarkerPath,
} from "../src/upgrade-marker-fixture.js";

describe("upgrade-marker-fixture", () => {
  it("seeds a backup file + marker entry for a pending artifact WITH preUpgradeContent", async () => {
    const fixture = await buildEmptyDir();
    try {
      const seeded = await seedInterruptedUpgrade(fixture.dir, [
        { relPath: "CLAUDE.md", kind: "merged", preUpgradeContent: "pre-crash content\n" },
      ]);
      expect(seeded.backupPaths.get("CLAUDE.md")).toBeDefined();
      expect(existsSync(backupDir(fixture.dir))).toBe(true);
      const marker = JSON.parse(await readFile(upgradeMarkerPath(fixture.dir), "utf8")) as {
        pending: Array<{ relPath: string; backupPath?: string }>;
      };
      expect(marker.pending).toHaveLength(1);
      expect(marker.pending[0]?.backupPath).toBeDefined();
    } finally {
      await fixture.cleanup();
    }
  });

  it("seeds a marker entry with NO backupPath for a pending artifact that did not exist before (no preUpgradeContent)", async () => {
    const fixture = await buildEmptyDir();
    try {
      const seeded = await seedInterruptedUpgrade(fixture.dir, [
        { relPath: ".claude/agents/eo-explore.md", kind: "full" },
      ]);
      expect(seeded.backupPaths.has(".claude/agents/eo-explore.md")).toBe(false);
      const marker = JSON.parse(await readFile(upgradeMarkerPath(fixture.dir), "utf8")) as {
        pending: Array<{ relPath: string; backupPath?: string }>;
      };
      expect(marker.pending).toHaveLength(1);
      expect(marker.pending[0]?.backupPath).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });

  it("seeds a mix of backed-up and no-backup pending artifacts in one call", async () => {
    const fixture = await buildEmptyDir();
    try {
      const seeded = await seedInterruptedUpgrade(fixture.dir, [
        { relPath: "CLAUDE.md", kind: "merged", preUpgradeContent: "old\n" },
        { relPath: ".claude/agents/eo-reviewer.md", kind: "full" },
      ]);
      expect(seeded.backupPaths.size).toBe(1);
      const marker = JSON.parse(await readFile(upgradeMarkerPath(fixture.dir), "utf8")) as {
        pending: Array<{ relPath: string; backupPath?: string }>;
      };
      expect(marker.pending).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });
});
