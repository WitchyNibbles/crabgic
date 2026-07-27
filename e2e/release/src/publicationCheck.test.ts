import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkPublication,
  FakeNpmViewRunner,
  RealNpmViewRunner,
  type NpmViewOutput,
} from "./publicationCheck.js";

const dirs: string[] = [];
async function seedManifest(manifest: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-publication-check-"));
  dirs.push(dir);
  const path = join(dir, "package.json");
  await writeFile(path, JSON.stringify(manifest), "utf8");
  return path;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const PUBLISHED_MANIFEST = { name: "crabgic", version: "1.0.0" };
const PRIVATE_MANIFEST = { ...PUBLISHED_MANIFEST, private: true };

function output(overrides: Partial<NpmViewOutput>): NpmViewOutput {
  return { stdout: "", stderr: "", exitCode: 0, ...overrides };
}

const E404 = output({
  exitCode: 1,
  stdout: '{\n  "error": {\n    "code": "E404",\n    "summary": "Not Found"\n  }\n}\n',
  stderr: "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/...\n",
});

async function check(
  packageJsonPath: string,
  registry: NpmViewOutput,
): Promise<Awaited<ReturnType<typeof checkPublication>>> {
  return checkPublication({
    packageJsonPath,
    packageName: "crabgic",
    version: "1.0.0",
    runner: new FakeNpmViewRunner(registry),
  });
}

describe("checkPublication — the exit criterion's `package published` clause", () => {
  it("FAIL-FIRST: reports the package as NOT published when the registry answers 404", async () => {
    const result = await check(await seedManifest(PUBLISHED_MANIFEST), E404);
    expect(result.registryAnswered).toBe(true);
    expect(result.publishedVersions).toEqual([]);
    expect(result.published).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("has never been published");
    expect(result.reasons[0]).toContain("package published");
  });

  it("reports the `private: true` manifest as its OWN reason — a private package cannot be published at all", async () => {
    const result = await check(await seedManifest(PRIVATE_MANIFEST), E404);
    expect(result.manifestPrivate).toBe(true);
    expect(result.reasons).toHaveLength(2);
    expect(result.reasons[0]).toContain('"private": true');
  });

  it("passes with zero reasons once the release version is actually on the registry", async () => {
    const result = await check(
      await seedManifest(PUBLISHED_MANIFEST),
      output({ stdout: '["0.9.0","1.0.0"]\n' }),
    );
    expect(result.published).toBe(true);
    expect(result.publishedVersions).toEqual(["0.9.0", "1.0.0"]);
    expect(result.reasons).toEqual([]);
  });

  it("understands npm's SINGLE-version output shape, which is a bare JSON string rather than an array", async () => {
    const result = await check(
      await seedManifest(PUBLISHED_MANIFEST),
      output({ stdout: '"1.0.0"' }),
    );
    expect(result.publishedVersions).toEqual(["1.0.0"]);
    expect(result.published).toBe(true);
  });

  it("reports the RELEASE version specifically — a registry carrying only other versions is not this release", async () => {
    const result = await check(
      await seedManifest(PUBLISHED_MANIFEST),
      output({ stdout: '["0.9.0"]' }),
    );
    expect(result.published).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("0.9.0");
  });

  it("treats an unparseable success payload as NO answer rather than as a publication", async () => {
    const result = await check(
      await seedManifest(PUBLISHED_MANIFEST),
      output({ stdout: "<html>" }),
    );
    expect(result.registryAnswered).toBe(false);
    expect(result.published).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("UNVERIFIED");
  });

  it("treats a JSON payload that is neither an array nor a string as zero known versions", async () => {
    const result = await check(await seedManifest(PUBLISHED_MANIFEST), output({ stdout: "{}" }));
    expect(result.registryAnswered).toBe(true);
    expect(result.publishedVersions).toEqual([]);
    expect(result.published).toBe(false);
  });

  it("FAILS CLOSED when the registry is unreachable — an offline run never counts as published", async () => {
    const result = await check(
      await seedManifest(PUBLISHED_MANIFEST),
      output({ exitCode: 1, stderr: "npm error code ENOTFOUND\nnpm error network getaddrinfo" }),
    );
    expect(result.registryAnswered).toBe(false);
    expect(result.published).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("ENOTFOUND");
  });

  it("still produces a quotable reason when npm fails with no output at all", async () => {
    const result = await check(await seedManifest(PUBLISHED_MANIFEST), output({ exitCode: 127 }));
    expect(result.registryAnswered).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("(no output)");
  });
});

describe("RealNpmViewRunner — genuine `npm view` child process", () => {
  /**
   * FLIPPED AT THE 1.0.0 CUT. This asserted `published === false` — true for
   * as long as the registry had nothing under this name, and false from the
   * moment `crabgic@1.0.0` was actually published with provenance. The check
   * queries the REAL registry, so its verdict tracks reality rather than a
   * fixture; the test now asserts the version that shipped is visible, and
   * that a version which never shipped is not.
   */
  it("reports this repo's own published version as published", async () => {
    const result = await checkPublication({
      packageJsonPath: await seedManifest(PUBLISHED_MANIFEST),
      packageName: "crabgic",
      version: "1.0.0",
      runner: new RealNpmViewRunner(),
    });
    expect(result.published).toBe(true);
    expect(result.reasons).toEqual([]);
  }, 60_000);

  it("still reports a version that was never published", async () => {
    const result = await checkPublication({
      packageJsonPath: await seedManifest(PUBLISHED_MANIFEST),
      packageName: "crabgic",
      version: "99.99.99",
      runner: new RealNpmViewRunner(),
    });
    expect(result.published).toBe(false);
    expect(result.reasons).toHaveLength(1);
  }, 60_000);
});
