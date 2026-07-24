import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Reproducible-build + publication-DRY-RUN tooling —
 * roadmap/23-release-hardening.md work item 10 (owner decision: PREPARE,
 * never publish/tag/mutate the marketplace for real). Every check in this
 * project is safe to run unconditionally: `npm pack`/`npm publish
 * --dry-run` never touch the real registry (this repo's own `packages/
 * cli/package.json` is `"private": true`, which `npm publish` itself
 * refuses regardless — a structural belt-and-suspenders against an
 * accidental real publish), `git archive`/`git worktree` are local-only,
 * and no artifact this project produces is ever executed
 * (`v1.0.0`-tag/`marketplace.json`-cut/`CHANGELOG.md` are all PREPARED
 * files or command-text scripts, never run/committed/tagged). No `@live`
 * split is needed — mirrors `e2e/report/`'s self-contained-project
 * convention (own tsconfig + vitest config, not wired into the root
 * `vitest.config.ts`'s `test.projects` fan-out — run standalone via
 * `npx vitest run e2e/release`).
 */
export default defineConfig({
  test: {
    root: HERE,
    include: ["src/**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    testTimeout: 60_000,
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
