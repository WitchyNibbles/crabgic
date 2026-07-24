import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  FakeCheckoutExporter,
  GitArchiveExporter,
  type CheckoutExporter,
} from "./checkoutExporter.js";
import { RealPackRunner, SequentialFakePackRunner, type PackRunner } from "./packRunner.js";
import {
  checkReproducibleBuild,
  createCopyCurrentDistPopulator,
} from "./reproducibleBuildCheck.js";

const execFileAsync = promisify(execFile);

describe("checkReproducibleBuild — unit (fake exporter + fake pack runner)", () => {
  it("reports match:true for two exports of the identical fixture commit, packed to identical content", async () => {
    const exporter = new FakeCheckoutExporter(
      new Map([["c1", { "package.json": '{"name":"fixture"}' }]]),
    );
    const packRunner = new SequentialFakePackRunner([
      Buffer.from("identical packed content"),
      Buffer.from("identical packed content"),
    ]);

    const result = await checkReproducibleBuild({
      exporter,
      packRunner,
      commitIsh: "c1",
      packageSubPath: "sub",
      populateBuildOutput: async () => {
        // no build output needed for this fixture
      },
    });

    expect(result.comparison.match).toBe(true);
  });

  it("FAIL-FIRST PROOF: a pack runner that returns DIFFERENT content per checkout fails the comparator", async () => {
    const exporter = new FakeCheckoutExporter(
      new Map([["c1", { "package.json": '{"name":"fixture"}' }]]),
    );
    const packRunner = new SequentialFakePackRunner([
      Buffer.from("checkout A content"),
      Buffer.from("checkout B DIFFERENT content"),
    ]);

    const result = await checkReproducibleBuild({
      exporter,
      packRunner,
      commitIsh: "c1",
      packageSubPath: "sub",
      populateBuildOutput: async () => {},
    });

    expect(result.comparison.match).toBe(false);
  });

  it("cleans up both exported directories even when packing throws", async () => {
    const exporter = new FakeCheckoutExporter(
      new Map([["c1", { "package.json": '{"name":"fixture"}' }]]),
    );
    const cleanedUp: string[] = [];
    const trackingExporter: CheckoutExporter = {
      exportCheckout: (commitIsh, subPath) => exporter.exportCheckout(commitIsh, subPath),
      cleanup: async (dir) => {
        cleanedUp.push(dir);
        await exporter.cleanup(dir);
      },
    };
    const failingPackRunner: PackRunner = {
      pack: async () => {
        throw new Error("simulated pack failure");
      },
    };

    await expect(
      checkReproducibleBuild({
        exporter: trackingExporter,
        packRunner: failingPackRunner,
        commitIsh: "c1",
        packageSubPath: "sub",
        populateBuildOutput: async () => {},
      }),
    ).rejects.toThrow("simulated pack failure");
    expect(cleanedUp).toHaveLength(2);
  });
});

describe("createCopyCurrentDistPopulator — unit", () => {
  it("copies the given dist directory's contents into <checkoutDir>/dist", async () => {
    const os = await import("node:os");
    const fsp = await import("node:fs/promises");
    const sourceRoot = await fsp.mkdtemp(join(os.tmpdir(), "eo-populator-source-"));
    const checkoutDir = await fsp.mkdtemp(join(os.tmpdir(), "eo-populator-checkout-"));
    try {
      await fsp.mkdir(join(sourceRoot, "pkg", "dist"), { recursive: true });
      await writeFile(join(sourceRoot, "pkg", "dist", "index.js"), "export {};");

      const populate = createCopyCurrentDistPopulator(sourceRoot, "pkg");
      await populate(checkoutDir);

      const copied = await readFile(join(checkoutDir, "dist", "index.js"), "utf8");
      expect(copied).toBe("export {};");
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
      await rm(checkoutDir, { recursive: true, force: true });
    }
  });
});

describe("checkReproducibleBuild — genuine integration (real git archive, real npm pack, packages/cli @ HEAD)", () => {
  it("two independent clean checkouts of the exact same commit produce byte-identical tarballs", async () => {
    const { stdout: repoRootRaw } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: import.meta.dirname,
    });
    const repoRoot = repoRootRaw.trim();
    const exporter = new GitArchiveExporter({ repoRoot });
    const packRunner = new RealPackRunner();
    const populateBuildOutput = createCopyCurrentDistPopulator(repoRoot, "packages/cli");

    const result = await checkReproducibleBuild({
      exporter,
      packRunner,
      commitIsh: "HEAD",
      packageSubPath: "packages/cli",
      populateBuildOutput,
    });

    expect(result.comparison.match).toBe(true);
    expect(result.packA.name).toBe("engineering-orchestrator");
    expect(result.packB.name).toBe("engineering-orchestrator");
  }, 30_000);

  it("FAIL-FIRST PROOF, real end to end: perturbing one checkout's copied dist by one byte after populateBuildOutput fails the real comparator", async () => {
    const { stdout: repoRootRaw } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: import.meta.dirname,
    });
    const repoRoot = repoRootRaw.trim();
    const exporter = new GitArchiveExporter({ repoRoot });
    const packRunner = new RealPackRunner();
    const realPopulate = createCopyCurrentDistPopulator(repoRoot, "packages/cli");

    let checkoutCount = 0;
    const perturbingPopulate = async (checkoutDir: string): Promise<void> => {
      await realPopulate(checkoutDir);
      checkoutCount += 1;
      if (checkoutCount === 2) {
        // Perturb only the SECOND checkout — simulates a genuine
        // from-clean-checkout drift.
        const target = join(checkoutDir, "dist", "index.js");
        const existing = await readFile(target, "utf8").catch(() => "");
        await writeFile(target, `${existing}\n// perturbed\n`);
      }
    };

    const result = await checkReproducibleBuild({
      exporter,
      packRunner,
      commitIsh: "HEAD",
      packageSubPath: "packages/cli",
      populateBuildOutput: perturbingPopulate,
    });

    expect(result.comparison.match).toBe(false);
  }, 30_000);
});
