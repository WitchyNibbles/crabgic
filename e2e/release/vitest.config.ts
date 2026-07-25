import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Reproducible-build + publication-DRY-RUN tooling —
 * roadmap/23-release-hardening.md work item 10 (owner decision: PREPARE,
 * never publish/tag/mutate the marketplace for real).
 *
 * Every check here is safe to run unconditionally, but "safe" is NOT the
 * same as "offline", and this project deliberately states its own
 * side-effect surface rather than implying it has none:
 *
 * - PREPARE-DON'T-PUBLISH holds absolutely. `npm pack`/`npm publish
 *   --dry-run` never publish (this repo's own `packages/cli/package.json`
 *   is `"private": true`, which `npm publish` itself refuses regardless —
 *   a structural belt-and-suspenders against an accidental real publish),
 *   `git archive`/`git worktree` are local-only, nothing is ever committed
 *   or tagged, and no artifact this project produces is ever executed
 *   (`v1.0.0`-tag/`marketplace.json`-cut/`CHANGELOG.md` are all PREPARED
 *   files or command-text scripts).
 * - ONE THING LEAVES THE MACHINE, on every composed-gate run:
 *   `publicationCheck.ts`'s `RealNpmViewRunner`, wired unconditionally
 *   into `runReleaseGateSummary`, issues a single read-only
 *   `npm view <name> versions --json` against registry.npmjs.org. It needs
 *   no credentials, publishes nothing and mutates nothing, and is bounded
 *   by `--fetch-retries=0 --fetch-timeout=15000` plus a 60s child-process
 *   timeout. It fails CLOSED: an unreachable registry is a
 *   release-blocking reason, NEVER a pass — so an air-gapped run still
 *   produces a correct verdict, it just pays up to that timeout and gets
 *   the "UNVERIFIED / no usable answer" wording for the "package
 *   published" clause instead of the "never published" wording.
 * - `npm ci` + `npm run build` also run, per exported checkout, but ONLY
 *   under `EO_RELEASE_REBUILD_CHECKOUTS=1`, which exists precisely so an
 *   offline invocation never hits the registry for the rebuild leg. See
 *   `src/rebuildPopulator.ts`; it is set only by
 *   `.github/workflows/release-e2e.yml`.
 *
 * No `@live` split is needed — mirrors `e2e/report/`'s
 * self-contained-project convention (own tsconfig + vitest config, not
 * wired into the root `vitest.config.ts`'s `test.projects` fan-out — run
 * standalone via `npx vitest run e2e/release`).
 */
export default defineConfig({
  test: {
    root: HERE,
    include: ["src/**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    // Raised from 60s: each reproducible-build checkout is now a WHOLE-
    // repository `git archive` export (a single-package export has no
    // lockfile and no sibling workspaces, so nothing can be built in it),
    // and `reproducibleBuildCheck.ts` populates the two checkouts
    // SEQUENTIALLY. Under `EO_RELEASE_REBUILD_CHECKOUTS=1` that means two
    // real `npm ci` + two full `tsc -b` runs, which 60s cannot fit; the
    // composed-gate test raises its own per-test timeout further again for
    // exactly that leg (see `releaseGateSummary.test.ts`).
    testTimeout: 120_000,
    coverage: {
      provider: "v8",
      enabled: true,
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["**/dist/**", "**/*.d.ts", "**/*.config.*"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
