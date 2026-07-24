import { cp } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckoutExporter } from "./checkoutExporter.js";
import type { PackResult, PackRunner } from "./packRunner.js";
import { compareTarballs, type TarballComparisonResult } from "./tarballComparator.js";

/**
 * Composes `CheckoutExporter` + `PackRunner` + `tarballComparator` into the
 * full "two independent clean checkouts, packed independently, tarballs
 * compared byte-for-byte" flow — roadmap/23-release-hardening.md work item
 * 10's own framing.
 *
 * BUILD-OUTPUT NOTE (a deliberate, documented scope boundary): `dist/` is
 * gitignored (never committed — confirmed against this repo's own
 * `.gitignore`), so a `git archive` export of committed source alone never
 * contains build output. The real release pipeline's own from-clean-
 * checkout step is `npm ci && npm run build` per checkout — re-running a
 * full monorepo TypeScript build twice inside THIS comparator would
 * duplicate that pipeline step and is a BUILD-determinism concern (do two
 * independent `tsc` invocations of identical source produce identical
 * output?), not this tarball-comparator's own job (does packing identical
 * FILES twice produce identical TARBALLS?). `populateBuildOutput` is the
 * injectable seam that separates the two concerns: this project's own
 * default (`createCopyCurrentDistPopulator`) copies the CURRENT,
 * already-built `dist/` into each independent export — proving the
 * packer itself is deterministic given identical committed source +
 * identical build output (the necessary condition for two independently-
 * scheduled from-clean-checkout release builds to match) — while a real
 * `release-e2e` CI invocation is expected to inject a populator that
 * actually re-runs the build per checkout instead.
 */
export interface ReproducibleBuildCheckOptions {
  readonly exporter: CheckoutExporter;
  readonly packRunner: PackRunner;
  readonly commitIsh: string;
  /** Relative to the exporter's own repo root, e.g. `"packages/cli"`. */
  readonly packageSubPath: string;
  readonly populateBuildOutput: (checkoutDir: string) => Promise<void>;
}

export interface ReproducibleBuildCheckResult {
  readonly comparison: TarballComparisonResult;
  readonly packA: PackResult;
  readonly packB: PackResult;
}

export async function checkReproducibleBuild(
  options: ReproducibleBuildCheckOptions,
): Promise<ReproducibleBuildCheckResult> {
  const dirA = await options.exporter.exportCheckout(options.commitIsh, options.packageSubPath);
  const dirB = await options.exporter.exportCheckout(options.commitIsh, options.packageSubPath);
  try {
    await options.populateBuildOutput(dirA);
    await options.populateBuildOutput(dirB);

    const [destA, destB] = await Promise.all([
      mkdtemp(join(tmpdir(), "eo-release-pack-out-a-")),
      mkdtemp(join(tmpdir(), "eo-release-pack-out-b-")),
    ]);
    const [packA, packB] = await Promise.all([
      options.packRunner.pack(dirA, destA),
      options.packRunner.pack(dirB, destB),
    ]);
    const comparison = await compareTarballs(packA.tarballPath, packB.tarballPath);
    return { comparison, packA, packB };
  } finally {
    await options.exporter.cleanup(dirA);
    await options.exporter.cleanup(dirB);
  }
}

/**
 * The real, default `populateBuildOutput`: copies `<repoRoot>/<packageSubPath>/
 * dist` (the CURRENT, already-built output of this repo's own `npm run
 * build`) into `<checkoutDir>/dist`. See this module's own file-level doc
 * comment for why this is the deliberate scope boundary rather than
 * re-invoking `tsc` per checkout.
 */
export function createCopyCurrentDistPopulator(
  repoRoot: string,
  packageSubPath: string,
): (checkoutDir: string) => Promise<void> {
  const sourceDist = join(repoRoot, packageSubPath, "dist");
  return async (checkoutDir: string) => {
    await cp(sourceDist, join(checkoutDir, "dist"), { recursive: true });
  };
}
