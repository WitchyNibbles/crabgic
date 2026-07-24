import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareTarballs, hashTarball } from "./tarballComparator.js";
import { FakePackRunner } from "./packRunner.js";

describe("compareTarballs — unit (fixture tarball-stand-in bytes, no real npm needed)", () => {
  let scratchDir: string;

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "eo-tarball-comparator-"));
  });

  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  it("reports match:true for two byte-identical tarballs", async () => {
    const pathA = join(scratchDir, "a.tgz");
    const pathB = join(scratchDir, "b.tgz");
    await writeFile(pathA, Buffer.from("identical content"));
    await writeFile(pathB, Buffer.from("identical content"));

    const result = await compareTarballs(pathA, pathB);
    expect(result.match).toBe(true);
    expect(result.hashA).toBe(result.hashB);
    expect(result.sizeA).toBe(result.sizeB);
  });

  it("FAIL-FIRST PROOF: a deliberately-perturbed tarball (one flipped byte) is reported as a mismatch", async () => {
    const pathA = join(scratchDir, "a.tgz");
    const pathB = join(scratchDir, "b-perturbed.tgz");
    await writeFile(pathA, Buffer.from("identical content"));
    // One byte different from pathA — simulates a real from-clean-checkout
    // rebuild drift (e.g. a nondeterministic build step).
    await writeFile(pathB, Buffer.from("identicbl content"));

    const result = await compareTarballs(pathA, pathB);
    expect(result.match).toBe(false);
    expect(result.hashA).not.toBe(result.hashB);
  });

  it("reports a size mismatch directly (not solely inferred from unequal hashes) when tarballs differ in length", async () => {
    const pathA = join(scratchDir, "a.tgz");
    const pathB = join(scratchDir, "b.tgz");
    await writeFile(pathA, Buffer.from("short"));
    await writeFile(pathB, Buffer.from("a much longer tarball payload"));

    const result = await compareTarballs(pathA, pathB);
    expect(result.match).toBe(false);
    expect(result.sizeA).not.toBe(result.sizeB);
  });

  it("propagates a read error (e.g. a missing tarball) rather than silently reporting match:false", async () => {
    const pathA = join(scratchDir, "a.tgz");
    await writeFile(pathA, Buffer.from("x"));
    const missing = join(scratchDir, "does-not-exist.tgz");
    await expect(compareTarballs(pathA, missing)).rejects.toThrow();
  });

  it("hashTarball computes a stable sha256 + byte size for a single tarball", async () => {
    const path = join(scratchDir, "a.tgz");
    await writeFile(path, Buffer.from("hello"));
    const { hash, size } = await hashTarball(path);
    expect(hash).toHaveLength(64); // hex sha256
    expect(size).toBe(5);
  });
});

describe("compareTarballs — via FakePackRunner (proves the comparator composes cleanly with the injectable PackRunner seam)", () => {
  let scratchDir: string;

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "eo-tarball-comparator-fake-pack-"));
  });

  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  it("two independent packs of identical fixture content match", async () => {
    const runner = new FakePackRunner(
      new Map([
        ["/fixture/checkout-a", Buffer.from("same package content")],
        ["/fixture/checkout-b", Buffer.from("same package content")],
      ]),
    );
    const packA = await runner.pack("/fixture/checkout-a", join(scratchDir, "a"));
    const packB = await runner.pack("/fixture/checkout-b", join(scratchDir, "b"));
    const result = await compareTarballs(packA.tarballPath, packB.tarballPath);
    expect(result.match).toBe(true);
  });

  it("FAIL-FIRST PROOF via the full PackRunner seam: a perturbed checkout's pack fails the comparator", async () => {
    const runner = new FakePackRunner(
      new Map([
        ["/fixture/checkout-a", Buffer.from("same package content")],
        ["/fixture/checkout-b-perturbed", Buffer.from("DIFFERENT package content")],
      ]),
    );
    const packA = await runner.pack("/fixture/checkout-a", join(scratchDir, "a"));
    const packB = await runner.pack("/fixture/checkout-b-perturbed", join(scratchDir, "b"));
    const result = await compareTarballs(packA.tarballPath, packB.tarballPath);
    expect(result.match).toBe(false);
  });
});
