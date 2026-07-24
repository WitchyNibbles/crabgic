import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareMarketplaceEntry, renderPreparedMarketplace } from "./marketplaceEntryPreparer.js";
import { MarketplaceSchema } from "@eo/plugin";

const execFileAsync = promisify(execFile);

async function writeFixturePlugin(
  pluginRoot: string,
  marketplace: Record<string, unknown>,
): Promise<void> {
  await mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(pluginRoot, ".claude-plugin", "marketplace.json"),
    JSON.stringify(marketplace),
    "utf8",
  );
  await writeFile(join(pluginRoot, "plugin.json"), JSON.stringify({ name: "fixture" }), "utf8");
}

const FIXTURE_MARKETPLACE = {
  $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
  name: "fixture-marketplace",
  description: "fixture",
  owner: { name: "Fixture Owner", email: "owner@example.invalid" },
  plugins: [
    {
      name: "fixture-plugin",
      source: "./",
      description: "a fixture plugin",
      version: "0.0.0",
      license: "Apache-2.0",
      commit: "0000000000000000000000000000000000000000",
      digest: "placeholder",
    },
  ],
};

describe("prepareMarketplaceEntry — unit (fixture plugin root + injected gitRevParse)", () => {
  let pluginRoot: string;

  beforeEach(async () => {
    pluginRoot = await mkdtemp(join(tmpdir(), "eo-marketplace-fixture-"));
    await writeFixturePlugin(pluginRoot, FIXTURE_MARKETPLACE);
  });

  afterEach(async () => {
    await rm(pluginRoot, { recursive: true, force: true });
  });

  it("prepares a schema-valid entry with the given version, a full-40-hex commit SHA, and a recomputed digest", async () => {
    const fullSha = "a".repeat(40);
    const entry = await prepareMarketplaceEntry({
      pluginRoot,
      repoRoot: pluginRoot,
      version: "1.0.0",
      gitRevParse: async () => fullSha,
    });

    expect(entry.name).toBe("fixture-plugin");
    expect(entry.version).toBe("1.0.0");
    expect(entry.commit).toBe(fullSha);
    expect(entry.digest).not.toBe("placeholder");
    expect(entry.digest.length).toBeGreaterThan(0);
    expect(entry.license).toBe("Apache-2.0");
  });

  it("never writes to the committed marketplace.json — it only returns the prepared object", async () => {
    const before = await import("node:fs/promises").then((fsp) =>
      fsp.readFile(join(pluginRoot, ".claude-plugin", "marketplace.json"), "utf8"),
    );
    await prepareMarketplaceEntry({
      pluginRoot,
      repoRoot: pluginRoot,
      version: "1.0.0",
      gitRevParse: async () => "b".repeat(40),
    });
    const after = await import("node:fs/promises").then((fsp) =>
      fsp.readFile(join(pluginRoot, ".claude-plugin", "marketplace.json"), "utf8"),
    );
    expect(after).toBe(before);
  });

  it("rejects a gitRevParse result that is not a full 40-hex SHA (schema validation, not this module's own logic)", async () => {
    await expect(
      prepareMarketplaceEntry({
        pluginRoot,
        repoRoot: pluginRoot,
        version: "1.0.0",
        gitRevParse: async () => "main",
      }),
    ).rejects.toThrow();
  });
});

describe("renderPreparedMarketplace", () => {
  it("substitutes the prepared entry in for the matching-by-name existing entry, leaving other fields untouched", () => {
    const existing = MarketplaceSchema.parse(FIXTURE_MARKETPLACE);
    const prepared = {
      ...existing.plugins[0]!,
      version: "1.0.0",
      commit: "c".repeat(40),
      digest: "new-digest",
    };
    const rendered = renderPreparedMarketplace(existing, prepared);
    expect(rendered.plugins).toHaveLength(1);
    expect(rendered.plugins[0]?.version).toBe("1.0.0");
    expect(rendered.name).toBe(existing.name);
  });
});

describe("prepareMarketplaceEntry — genuine integration (real git rev-parse HEAD, real packages/plugin)", () => {
  it("prepares a real, schema-valid v1.0.0 entry from this repo's own committed marketplace.json", async () => {
    const repoRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
    ).stdout.trim();
    const pluginRoot = resolve(repoRoot, "packages", "plugin");

    const entry = await prepareMarketplaceEntry({ pluginRoot, repoRoot, version: "1.0.0" });

    expect(entry.name).toBe("engineering-orchestrator");
    expect(entry.version).toBe("1.0.0");
    expect(entry.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(entry.license).toBe("Apache-2.0");
    expect(entry.digest.length).toBeGreaterThan(0);
  });
});
