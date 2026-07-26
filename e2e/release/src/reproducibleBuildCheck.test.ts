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
  type BuildOutputPopulator,
} from "./reproducibleBuildCheck.js";

const execFileAsync = promisify(execFile);

const NOOP_POPULATOR: BuildOutputPopulator = {
  rebuildsFromCleanCheckout: false,
  populate: async () => {
    // no build output needed for the fixture-driven cases
  },
};

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
      populateBuildOutput: NOOP_POPULATOR,
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
      populateBuildOutput: NOOP_POPULATOR,
    });

    expect(result.comparison.match).toBe(false);
  });

  it("exports the WHOLE repository (no subPath) and packs from <checkout>/<packageSubPath>", async () => {
    const exporter = new FakeCheckoutExporter(new Map([["c1", { "a.txt": "x" }]]));
    const requestedSubPaths: (string | undefined)[] = [];
    const packedDirs: string[] = [];
    const recordingExporter: CheckoutExporter = {
      exportCheckout: async (commitIsh, subPath) => {
        requestedSubPaths.push(subPath);
        return exporter.exportCheckout(commitIsh, subPath);
      },
      cleanup: (dir) => exporter.cleanup(dir),
    };
    const packRunner: PackRunner = {
      pack: async (packageDir, destDir) => {
        packedDirs.push(packageDir);
        return new SequentialFakePackRunner([Buffer.from("same")]).pack(packageDir, destDir);
      },
    };

    await checkReproducibleBuild({
      exporter: recordingExporter,
      packRunner,
      commitIsh: "c1",
      packageSubPath: "packages/cli",
      populateBuildOutput: NOOP_POPULATOR,
    });

    expect(requestedSubPaths).toEqual([undefined, undefined]);
    expect(packedDirs.every((dir) => dir.endsWith(join("packages", "cli")))).toBe(true);
  });

  it("records whether the checkouts were genuinely REBUILT or merely populated from the current dist/", async () => {
    const exporter = new FakeCheckoutExporter(new Map([["c1", { "a.txt": "x" }]]));
    const packRunner = new SequentialFakePackRunner([Buffer.from("same"), Buffer.from("same")]);
    const rebuilding: BuildOutputPopulator = {
      rebuildsFromCleanCheckout: true,
      populate: async () => {},
    };

    const copied = await checkReproducibleBuild({
      exporter,
      packRunner: new SequentialFakePackRunner([Buffer.from("same"), Buffer.from("same")]),
      commitIsh: "c1",
      packageSubPath: "sub",
      populateBuildOutput: NOOP_POPULATOR,
    });
    const rebuilt = await checkReproducibleBuild({
      exporter,
      packRunner,
      commitIsh: "c1",
      packageSubPath: "sub",
      populateBuildOutput: rebuilding,
    });

    expect(copied.rebuiltFromCleanCheckout).toBe(false);
    expect(rebuilt.rebuiltFromCleanCheckout).toBe(true);
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
        populateBuildOutput: NOOP_POPULATOR,
      }),
    ).rejects.toThrow("simulated pack failure");
    expect(cleanedUp).toHaveLength(2);
  });
});

describe("createCopyCurrentDistPopulator — unit", () => {
  it("copies the given dist directory's contents into <checkoutDir>/<packageSubPath>/dist", async () => {
    const os = await import("node:os");
    const fsp = await import("node:fs/promises");
    const sourceRoot = await fsp.mkdtemp(join(os.tmpdir(), "eo-populator-source-"));
    const checkoutDir = await fsp.mkdtemp(join(os.tmpdir(), "eo-populator-checkout-"));
    try {
      await fsp.mkdir(join(sourceRoot, "pkg", "dist"), { recursive: true });
      await writeFile(join(sourceRoot, "pkg", "dist", "index.js"), "export {};");

      const populator = createCopyCurrentDistPopulator(sourceRoot, "pkg");
      expect(populator.rebuildsFromCleanCheckout).toBe(false);
      await populator.populate(checkoutDir);

      const copied = await readFile(join(checkoutDir, "pkg", "dist", "index.js"), "utf8");
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
    expect(result.packA.name).toBe("crabgic");
    expect(result.packB.name).toBe("crabgic");
    // The honest qualifier this result now carries: nothing was rebuilt.
    expect(result.rebuiltFromCleanCheckout).toBe(false);
  }, 60_000);

  it("FAIL-FIRST PROOF, real end to end: perturbing one checkout's copied dist by one byte after populateBuildOutput fails the real comparator", async () => {
    const { stdout: repoRootRaw } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: import.meta.dirname,
    });
    const repoRoot = repoRootRaw.trim();
    const exporter = new GitArchiveExporter({ repoRoot });
    const realPopulator = createCopyCurrentDistPopulator(repoRoot, "packages/cli");

    let checkoutCount = 0;
    const perturbingPopulator: BuildOutputPopulator = {
      rebuildsFromCleanCheckout: false,
      populate: async (checkoutDir: string): Promise<void> => {
        await realPopulator.populate(checkoutDir);
        checkoutCount += 1;
        if (checkoutCount === 2) {
          // Perturb only the SECOND checkout — simulates a genuine
          // from-clean-checkout drift.
          const target = join(checkoutDir, "packages", "cli", "dist", "index.js");
          const existing = await readFile(target, "utf8").catch(() => "");
          await writeFile(target, `${existing}\n// perturbed\n`);
        }
      },
    };

    const result = await checkReproducibleBuild({
      exporter,
      packRunner: new RealPackRunner(),
      commitIsh: "HEAD",
      packageSubPath: "packages/cli",
      populateBuildOutput: perturbingPopulator,
    });

    expect(result.comparison.match).toBe(false);
  }, 60_000);
});
