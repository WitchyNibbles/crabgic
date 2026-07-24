import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FakePackRunner,
  NpmPackFailedError,
  parseNpmPackJson,
  RealPackRunner,
  SequentialFakePackRunner,
} from "./packRunner.js";

describe("FakePackRunner — unit", () => {
  let scratchDir: string;

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "eo-fake-pack-runner-"));
  });

  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  it("writes the registered fixture content and computes a real sha1 over those exact bytes", async () => {
    const content = Buffer.from("fixture tarball bytes");
    const runner = new FakePackRunner(new Map([["/fixture/pkg", content]]), "fixture-pkg", "1.2.3");
    const result = await runner.pack("/fixture/pkg", join(scratchDir, "dest"));
    expect(result.name).toBe("fixture-pkg");
    expect(result.version).toBe("1.2.3");
    const written = await readFile(result.tarballPath);
    expect(written.equals(content)).toBe(true);
    expect(result.npmReportedShasum).toHaveLength(40); // hex sha1
  });

  it("throws NpmPackFailedError for an unregistered packageDir", async () => {
    const runner = new FakePackRunner(new Map());
    await expect(runner.pack("/unregistered", scratchDir)).rejects.toThrow(NpmPackFailedError);
  });
});

describe("SequentialFakePackRunner — unit", () => {
  let scratchDir: string;

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "eo-sequential-fake-pack-runner-"));
  });

  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  it("returns each content entry in call order, ignoring packageDir", async () => {
    const runner = new SequentialFakePackRunner([Buffer.from("first"), Buffer.from("second")]);
    const first = await runner.pack("/anything", join(scratchDir, "a"));
    const second = await runner.pack("/something-else", join(scratchDir, "b"));
    expect((await readFile(first.tarballPath)).toString()).toBe("first");
    expect((await readFile(second.tarballPath)).toString()).toBe("second");
  });

  it("throws NpmPackFailedError once the registered fixture contents are exhausted", async () => {
    const runner = new SequentialFakePackRunner([Buffer.from("only-one")]);
    await runner.pack("/a", join(scratchDir, "a"));
    await expect(runner.pack("/b", join(scratchDir, "b"))).rejects.toThrow(NpmPackFailedError);
  });
});

describe("parseNpmPackJson — unit", () => {
  it("parses a real npm pack --json single-entry array shape", () => {
    const stdout = JSON.stringify([
      { filename: "fixture-1.0.0.tgz", name: "fixture", version: "1.0.0", shasum: "abc123" },
    ]);
    const entry = parseNpmPackJson("/pkg", stdout);
    expect(entry).toEqual({
      filename: "fixture-1.0.0.tgz",
      name: "fixture",
      version: "1.0.0",
      shasum: "abc123",
    });
  });

  it("throws NpmPackFailedError for an empty array (npm pack --json's documented-impossible-but-defensive shape)", () => {
    expect(() => parseNpmPackJson("/pkg", "[]")).toThrow(NpmPackFailedError);
  });
});

describe("RealPackRunner — genuine integration (real npm pack, this repo's own packages/cli, no network)", () => {
  it("packs packages/cli for real and returns a well-formed result matching its package.json", async () => {
    const packageDir = resolve(import.meta.dirname, "..", "..", "..", "packages", "cli");
    const scratchDir = await mkdtemp(join(tmpdir(), "eo-real-pack-runner-"));
    try {
      const runner = new RealPackRunner();
      const result = await runner.pack(packageDir, scratchDir);
      expect(result.name).toBe("engineering-orchestrator");
      const bytes = await readFile(result.tarballPath);
      expect(bytes.length).toBeGreaterThan(0);
      expect(result.npmReportedShasum).toHaveLength(40);
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });

  it("throws NpmPackFailedError for a directory with no package.json at all", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "eo-real-pack-runner-empty-"));
    const destDir = await mkdtemp(join(tmpdir(), "eo-real-pack-runner-dest-"));
    try {
      const runner = new RealPackRunner();
      await expect(runner.pack(emptyDir, destDir)).rejects.toThrow(NpmPackFailedError);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
      await rm(destDir, { recursive: true, force: true });
    }
  });
});
