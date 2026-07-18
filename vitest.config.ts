import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

// Phase 01 (work item 3): single root Vitest config using `test.projects` to
// fan out across every workspace package (Vitest 4's replacement for the
// deprecated standalone `vitest.workspace.ts` file). Coverage is v8-based
// with an 80% line+branch (+function+statement) gate enforced globally.
// At this phase the 18 packages are empty stubs with no test files, so the
// gate has nothing to measure yet — `passWithNoTests` keeps that state green.
// The gate's bite is demonstrated separately via a temporary fixture package
// (see docs/evidence/phase-01/wi3-*) and then removed.
//
// Phase-02 integration fix (of a latent phase-01 gap): a bare-glob string
// entry in `test.projects` (the original "packages/*") resolves each
// matched package directory with Vite's `configFile: false` — verified
// against Vitest 4.1.10's own `resolveTestProjectConfigs`/
// `initializeProject` source, a glob-matched directory with no vitest
// config of its own never loads or merges this root file's own `test`
// settings (only a small fixed allowlist of CLI-only overrides crosses
// that boundary, and `exclude` is not among them). Concretely: Vitest 4's
// own defaultExclude is only `node_modules/**`/`.git/**`, so compiled
// `dist/**/*.test.js` duplicates left behind by any `tsc -b` were being
// picked up as real test files a second time, per package, with no way to
// suppress them from a single `test.exclude` line added to this file as
// long as `projects` stayed a bare glob string. The fix: enumerate each
// package directory ourselves and declare each as an explicit project
// object with `extends: true`, which DOES load and merge this root
// config — including `exclude` — into every per-package project.
const packageDirs = readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `packages/${entry.name}`);

/**
 * Each package's own `package.json` "name" (e.g. `@eo/testkit`), read
 * synchronously at config-load time, so per-project output keeps the same
 * `|@eo/testkit|`-style labels the original bare-glob `projects` form
 * produced — `extends: true` project objects don't get that label for
 * free the way glob-matched directories did.
 */
function readPackageName(root: string): string {
  const raw = readFileSync(join(REPO_ROOT, root, "package.json"), "utf8");
  return (JSON.parse(raw) as { readonly name: string }).name;
}

export default defineConfig({
  test: {
    projects: packageDirs.map((root) => ({
      extends: true,
      test: { root, name: readPackageName(root) },
    })),
    passWithNoTests: true,
    // The default 5s per-test timeout is too tight for this repo's legitimate
    // >=10k-case fast-check property suites (envelope-compiler footguns, config
    // monotonicity, journal recovery, lease interleavings). Scoped they finish
    // in ~1-2s, but under full-suite parallel CPU contention (18+ packages'
    // test files at once) a 10k-case run can exceed 5s and flake. 20s gives
    // ample headroom while still failing a genuinely hung test promptly.
    testTimeout: 20000,
    // See the file-level comment above: this now actually takes effect
    // per-package, unlike under the original bare-glob `projects` form.
    exclude: ["**/dist/**", "**/node_modules/**", "**/.git/**"],
    coverage: {
      provider: "v8",
      enabled: true,
      reporter: ["text", "lcov", "html"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/dist/**", "**/*.d.ts", "**/*.config.*", "**/node_modules/**"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
