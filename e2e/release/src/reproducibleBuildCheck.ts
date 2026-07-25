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
 * BUILD-OUTPUT NOTE (a real, reported gap — no longer a silent scope
 * boundary): `dist/` is gitignored (never committed — confirmed against
 * this repo's own `.gitignore`), so a `git archive` export of committed
 * source alone never contains build output. `populateBuildOutput` is the
 * injectable seam that supplies it, and the two available populators
 * answer DIFFERENT questions:
 *
 *   - `createCopyCurrentDistPopulator` copies the CURRENT, already-built
 *     `dist/` into each independent export. That proves the PACKER is
 *     deterministic given identical committed source + identical build
 *     output — a necessary condition, but NOT the exit criterion's own
 *     words ("two independent from-clean-checkout BUILDS").
 *   - `rebuildPopulator.ts`'s `createRebuildFromCleanCheckoutPopulator`
 *     runs `npm ci && npm run build` inside each export, which is the
 *     criterion itself. It needs network, so it is env-gated to
 *     `release-e2e.yml` (see that module).
 *
 * Which one ran is recorded on the result as `rebuiltFromCleanCheckout`
 * and SCORED by `releaseGateSummary.ts` — a copy-only run is a
 * release-blocking reason, never a quiet pass. Each export is now the
 * WHOLE repository (see `CheckoutExporter.exportCheckout`), because a
 * single-package export has no lockfile and no sibling workspaces and so
 * cannot be built at all.
 */

/**
 * How a checkout gets its build output, plus the one fact the gate must
 * know about that choice: whether the output was genuinely REBUILT in the
 * checkout or merely copied in from an existing build.
 */
export interface BuildOutputPopulator {
  /** `true` iff `populate` produces the build output by re-running the real build inside the checkout. */
  readonly rebuildsFromCleanCheckout: boolean;
  /** `checkoutDir` is the exported REPOSITORY root, not the package directory. */
  populate(checkoutDir: string): Promise<void>;
}

export interface ReproducibleBuildCheckOptions {
  readonly exporter: CheckoutExporter;
  readonly packRunner: PackRunner;
  readonly commitIsh: string;
  /** Relative to the exported repository root, e.g. `"packages/cli"` — the package that gets packed. */
  readonly packageSubPath: string;
  readonly populateBuildOutput: BuildOutputPopulator;
}

export interface ReproducibleBuildCheckResult {
  readonly comparison: TarballComparisonResult;
  readonly packA: PackResult;
  readonly packB: PackResult;
  /** Whether both checkouts were genuinely rebuilt from clean, or only populated from an existing `dist/`. */
  readonly rebuiltFromCleanCheckout: boolean;
}

export async function checkReproducibleBuild(
  options: ReproducibleBuildCheckOptions,
): Promise<ReproducibleBuildCheckResult> {
  // No sub-path: each export must be a whole, buildable repository.
  const dirA = await options.exporter.exportCheckout(options.commitIsh);
  const dirB = await options.exporter.exportCheckout(options.commitIsh);
  try {
    await options.populateBuildOutput.populate(dirA);
    await options.populateBuildOutput.populate(dirB);

    const [destA, destB] = await Promise.all([
      mkdtemp(join(tmpdir(), "eo-release-pack-out-a-")),
      mkdtemp(join(tmpdir(), "eo-release-pack-out-b-")),
    ]);
    const [packA, packB] = await Promise.all([
      options.packRunner.pack(join(dirA, options.packageSubPath), destA),
      options.packRunner.pack(join(dirB, options.packageSubPath), destB),
    ]);
    const comparison = await compareTarballs(packA.tarballPath, packB.tarballPath);
    return {
      comparison,
      packA,
      packB,
      rebuiltFromCleanCheckout: options.populateBuildOutput.rebuildsFromCleanCheckout,
    };
  } finally {
    await options.exporter.cleanup(dirA);
    await options.exporter.cleanup(dirB);
  }
}

/**
 * Copies `<repoRoot>/<packageSubPath>/dist` (the CURRENT, already-built
 * output of this repo's own `npm run build`) into
 * `<checkoutDir>/<packageSubPath>/dist`. See this module's own file-level
 * doc comment for exactly which question this answers and which it does
 * not — and note that `rebuildsFromCleanCheckout: false` is what makes the
 * difference visible in the gate's verdict.
 */
export function createCopyCurrentDistPopulator(
  repoRoot: string,
  packageSubPath: string,
): BuildOutputPopulator {
  const sourceDist = join(repoRoot, packageSubPath, "dist");
  return {
    rebuildsFromCleanCheckout: false,
    async populate(checkoutDir: string): Promise<void> {
      await cp(sourceDist, join(checkoutDir, packageSubPath, "dist"), { recursive: true });
    },
  };
}
