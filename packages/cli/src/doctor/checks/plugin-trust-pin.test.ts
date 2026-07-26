import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginTrustPinCheck } from "./plugin-trust-pin.js";

const dirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-plugin-trust-pin-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    name: "crabgic",
    source: "./",
    description: "d",
    version: "0.0.0",
    license: "Apache-2.0",
    commit: "a".repeat(40),
    digest: "somedigest",
    ...overrides,
  };
}

async function seedMarketplace(
  dir: string,
  plugins: readonly Record<string, unknown>[],
): Promise<void> {
  await mkdir(join(dir, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(dir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
      name: "m",
      description: "d",
      owner: { name: "o", email: "o@example.invalid" },
      plugins,
    }),
    "utf8",
  );
}

describe("createPluginTrustPinCheck", () => {
  it("passes for a properly SHA-pinned marketplace.json", async () => {
    const dir = await makeTmpDir();
    await seedMarketplace(dir, [validEntry()]);
    const finding = await createPluginTrustPinCheck({ pluginSourceDir: dir }).run();
    expect(finding.passed).toBe(true);
  });

  it("fails a seeded unpinned (branch-ref) plugin source with a non-destructive repair step", async () => {
    const dir = await makeTmpDir();
    await seedMarketplace(dir, [validEntry({ commit: "main" })]);
    const finding = await createPluginTrustPinCheck({ pluginSourceDir: dir }).run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("SHA-pinned");
    expect(finding.repairStep).toBeDefined();
  });

  it("fails gracefully when marketplace.json is missing entirely", async () => {
    const dir = await makeTmpDir();
    const finding = await createPluginTrustPinCheck({ pluginSourceDir: dir }).run();
    expect(finding.passed).toBe(false);
  });

  it("fails a source pinned to the all-zero null object ID — a placeholder with a pin's shape", async () => {
    const dir = await makeTmpDir();
    await seedMarketplace(dir, [validEntry({ commit: "0".repeat(40) })]);
    const finding = await createPluginTrustPinCheck({ pluginSourceDir: dir }).run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("all-zero placeholder");
  });

  // HISTORY, because this has flipped twice and both flips were meant to be
  // deliberate. It first claimed "this package's own real marketplace.json
  // passes", which the old regex-only pin check allowed because git's
  // all-zero null object ID has a pin's shape. It was then made honest: a
  // FAULT until the listing was cut at a release commit. The v1.0.0 entry is
  // now pinned, so the doctor verdict is a genuine pass.
  it("this package's own real @crabgic/plugin marketplace.json now PASSES — the entry is pinned at the release commit", async () => {
    const pluginRoot = new URL("../../../../plugin", import.meta.url).pathname;
    const finding = await createPluginTrustPinCheck({ pluginSourceDir: pluginRoot }).run();
    expect(finding.passed).toBe(true);
    expect(finding.evidence).not.toContain("all-zero placeholder");
  });
});
