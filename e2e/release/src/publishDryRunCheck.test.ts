import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkPackageMetadata,
  FakePublishRunner,
  RealPublishRunner,
  runPublishDryRun,
} from "./publishDryRunCheck.js";

describe("checkPackageMetadata — unit (fixture manifests)", () => {
  let scratchDir: string;

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "eo-publish-metadata-fixture-"));
  });

  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  it("reports ready:true when every prerequisite is present", async () => {
    const manifestPath = join(scratchDir, "package.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        name: "fixture",
        license: "Apache-2.0",
        publishConfig: { access: "public" },
        repository: { type: "git", url: "https://example.invalid/fixture.git" },
      }),
    );
    const result = checkPackageMetadata(manifestPath);
    expect(result).toEqual({
      hasName: true,
      hasLicenseApache2: true,
      hasPublicAccess: true,
      hasRepositoryField: true,
      ready: true,
      findings: [],
    });
  });

  it("reports every missing prerequisite as a distinct finding, ready:false", async () => {
    const manifestPath = join(scratchDir, "package.json");
    await writeFile(manifestPath, JSON.stringify({}));
    const result = checkPackageMetadata(manifestPath);
    expect(result.ready).toBe(false);
    expect(result.hasName).toBe(false);
    expect(result.hasLicenseApache2).toBe(false);
    expect(result.hasPublicAccess).toBe(false);
    expect(result.hasRepositoryField).toBe(false);
    expect(result.findings).toHaveLength(4);
  });

  it("reports ready:false when only the repository field is missing (today's real gap)", async () => {
    const manifestPath = join(scratchDir, "package.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        name: "fixture",
        license: "Apache-2.0",
        publishConfig: { access: "public" },
      }),
    );
    const result = checkPackageMetadata(manifestPath);
    expect(result.ready).toBe(false);
    expect(result.hasRepositoryField).toBe(false);
    expect(result.findings).toEqual([
      '"repository" field is missing — npm provenance attestation needs it to resolve the source ' +
        "repo; a real provenance-attested publish would not be ready until this is added.",
    ]);
  });

  it("rejects a license string that isn't exactly Apache-2.0", async () => {
    const manifestPath = join(scratchDir, "package.json");
    await writeFile(manifestPath, JSON.stringify({ license: "MIT" }));
    expect(checkPackageMetadata(manifestPath).hasLicenseApache2).toBe(false);
  });
});

describe("runPublishDryRun — unit (fake runner, no real npm)", () => {
  let scratchDir: string;

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "eo-publish-dry-run-fixture-"));
  });

  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  it("realPublishAttempted is always false, and skippedDueToPrivate is parsed from the runner's own output", async () => {
    await writeFile(
      join(scratchDir, "package.json"),
      JSON.stringify({
        name: "fixture",
        license: "Apache-2.0",
        publishConfig: { access: "public" },
        repository: { type: "git", url: "https://example.invalid/fixture.git" },
      }),
    );
    const runner = new FakePublishRunner({
      stdout: "",
      stderr: "npm warn publish Skipping workspace fixture, marked as private",
      exitCode: 0,
    });
    const result = await runPublishDryRun({ runner, packageDir: scratchDir });
    expect(result.realPublishAttempted).toBe(false);
    expect(result.skippedDueToPrivate).toBe(true);
    expect(result.metadata.ready).toBe(true);
  });

  it("skippedDueToPrivate is false when the runner's output never mentions a private skip", async () => {
    await writeFile(join(scratchDir, "package.json"), JSON.stringify({ name: "fixture" }));
    const runner = new FakePublishRunner({ stdout: "+ fixture@1.0.0", stderr: "", exitCode: 0 });
    const result = await runPublishDryRun({ runner, packageDir: scratchDir });
    expect(result.skippedDueToPrivate).toBe(false);
  });
});

describe("RealPublishRunner + runPublishDryRun — genuine integration (real npm publish --dry-run, this repo's own packages/cli, NEVER a real publish)", () => {
  it("captures npm's real dry-run output, confirms the private-package skip, and surfaces today's real missing-repository-field metadata gap", async () => {
    const packageDir = resolve(import.meta.dirname, "..", "..", "..", "packages", "cli");
    const runner = new RealPublishRunner();
    const result = await runPublishDryRun({ runner, packageDir });

    expect(result.realPublishAttempted).toBe(false);
    // packages/cli/package.json is "private": true today — npm publish
    // itself refuses to actually publish, regardless of --dry-run.
    expect(result.skippedDueToPrivate).toBe(true);
    expect(result.dryRun.exitCode).toBe(0);

    // Today's real, reportable gap: license/access/name are all correct,
    // but no "repository" field is declared yet.
    expect(result.metadata.hasLicenseApache2).toBe(true);
    expect(result.metadata.hasPublicAccess).toBe(true);
    expect(result.metadata.hasName).toBe(true);
    expect(result.metadata.hasRepositoryField).toBe(false);
    expect(result.metadata.ready).toBe(false);
  }, 30_000);

  it("RealPublishRunner reports a nonzero exitCode (real catch-branch, never actually publishing) for a directory with no package.json at all", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "eo-real-publish-empty-"));
    try {
      const runner = new RealPublishRunner();
      const output = await runner.publishDryRun(emptyDir);
      expect(output.exitCode).not.toBe(0);
      expect(output.stderr.length).toBeGreaterThan(0);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
