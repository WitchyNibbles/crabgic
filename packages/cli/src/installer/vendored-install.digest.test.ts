/**
 * roadmap/10-plugin-and-installer.md exit criterion: "`marketplace.json` is
 * SHA-pinned and schema-valid; a vendored `--plugin-dir` install resolves
 * to the identical digest as the marketplace listing — `marketplace.schema
 * .test` + `vendored-install.digest.test`." A "vendored `--plugin-dir`
 * install" is, at the content-digest layer, just `computeContentDigest`
 * run directly against a copied-to-disk plugin directory — this proves
 * that computation (as this installer would run it against any vendored
 * copy) matches the digest `packages/plugin`'s own committed
 * `marketplace.json` records for itself.
 */
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeContentDigest, loadMarketplace } from "@eo/plugin";

const PLUGIN_ROOT = new URL("../../../plugin", import.meta.url).pathname;

const dirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-vendored-install-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("vendored-install.digest.test", () => {
  it("a --plugin-dir vendored copy of the plugin resolves to the identical digest as the marketplace listing", async () => {
    const vendoredDir = await makeTmpDir();
    // Simulate a "vendored `--plugin-dir` install": a plain filesystem copy
    // of the plugin package, exactly what a user pointing `--plugin-dir` at
    // a locally-vendored checkout would have on disk.
    await cp(PLUGIN_ROOT, vendoredDir, { recursive: true });

    const vendoredDigest = computeContentDigest(vendoredDir);
    const marketplace = loadMarketplace(PLUGIN_ROOT);

    expect(vendoredDigest).toBe(marketplace.plugins[0]!.digest);
  });

  it("the marketplace listing's own recorded digest matches a fresh recomputation from the source plugin directory itself (freshness)", () => {
    const marketplace = loadMarketplace(PLUGIN_ROOT);
    expect(marketplace.plugins[0]!.digest).toBe(computeContentDigest(PLUGIN_ROOT));
  });
});
