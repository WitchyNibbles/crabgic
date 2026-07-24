/**
 * roadmap/10-plugin-and-installer.md exit criterion, suite `drift.fixtures`:
 * "Drift detector flags every seeded single-artifact mutation across
 * `CLAUDE.md`, `settings.json`, `.mcp.json`, and `eo-*.md`."
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeChecksum } from "./checksum.js";
import { detectDrift } from "./drift-detector.js";
import type { InstallState } from "./state-store.js";

const dirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-drift-fixtures-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const TRACKED_ARTIFACTS: ReadonlyArray<{ relPath: string; content: string }> = [
  { relPath: "CLAUDE.md", content: "# Managed\n" },
  { relPath: join(".claude", "settings.json"), content: '{"attribution":{"commit":"","pr":""}}\n' },
  { relPath: ".mcp.json", content: '{"mcpServers":{}}\n' },
  { relPath: join(".claude", "agents", "eo-explore.md"), content: "---\nname: eo-explore\n---\n" },
];

async function seedInstalledProject(dir: string): Promise<InstallState> {
  const artifacts = [];
  for (const artifact of TRACKED_ARTIFACTS) {
    const fullPath = join(dir, artifact.relPath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, artifact.content, "utf8");
    artifacts.push({
      relPath: artifact.relPath,
      kind: "full" as const,
      installedChecksum: computeChecksum(artifact.content),
      sourceVersion: "0.0.0",
    });
  }
  return {
    schemaVersion: 1,
    installedAt: new Date(0).toISOString(),
    sourceVersion: "0.0.0",
    sourceDigest: "irrelevant-for-this-suite",
    artifacts,
  };
}

describe("drift.fixtures — single-byte mutation of each tracked artifact is flagged", () => {
  it.each(TRACKED_ARTIFACTS.map((a) => a.relPath))(
    "flags a single-byte mutation of %s",
    async (mutatedRelPath) => {
      const dir = await makeTmpDir();
      const state = await seedInstalledProject(dir);

      // A stub detector (work item 3's own first-failing-test framing)
      // would report NO findings here — this asserts the REAL detector
      // does catch it.
      await writeFile(
        join(dir, mutatedRelPath),
        `${await readCurrent(dir, mutatedRelPath)}X`,
        "utf8",
      );

      const findings = await detectDrift(dir, state);
      expect(findings).toEqual([{ relPath: mutatedRelPath, kind: "modified" }]);
    },
  );

  it("flags a missing artifact (deleted after install) distinctly from a modified one", async () => {
    const dir = await makeTmpDir();
    const state = await seedInstalledProject(dir);
    await rm(join(dir, "CLAUDE.md"));

    const findings = await detectDrift(dir, state);
    expect(findings).toEqual([{ relPath: "CLAUDE.md", kind: "missing" }]);
  });

  it("reports zero findings when nothing has changed since install", async () => {
    const dir = await makeTmpDir();
    const state = await seedInstalledProject(dir);
    expect(await detectDrift(dir, state)).toEqual([]);
  });

  it("is unaffected by a CRLF/LF-only line-ending change (not real drift)", async () => {
    const dir = await makeTmpDir();
    const state = await seedInstalledProject(dir);
    const current = await readCurrent(dir, "CLAUDE.md");
    await writeFile(join(dir, "CLAUDE.md"), current.replace(/\n/g, "\r\n"), "utf8");
    expect(await detectDrift(dir, state)).toEqual([]);
  });
});

async function readCurrent(dir: string, relPath: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(join(dir, relPath), "utf8");
}
