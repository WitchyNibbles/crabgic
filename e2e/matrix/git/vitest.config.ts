import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Git-invariance + neutral-rendering matrix harness —
 * roadmap/23-release-hardening.md work item 5 ("Git-invariance +
 * neutral-rendering matrix harness against 07/08 ... failing-test-first:
 * harness FAILs on a seeded commit body carrying an attribution leak").
 * Mirrors `e2e/report/vitest.config.ts` / `e2e/provisioning/vitest.config
 * .ts`'s own self-contained-project convention: this directory is NOT
 * wired into the root `vitest.config.ts`'s `test.projects` fan-out — it
 * runs standalone via `npx vitest run e2e/matrix/git` (or `--config
 * e2e/matrix/git/vitest.config.ts`).
 *
 * Every scenario here drives REAL `@crabgic/git-engine` (07's plumbing/
 * invariance-harness/repo-validation/overlap-analyzer, 08's preflight/
 * branch-namer/commit-renderer/publish-local) and REAL `@crabgic/renderer`
 * (`lint`/`renderWithRegeneration`) against REAL throwaway temp git repos —
 * no mocked git, no fake renderer. No network, no live engine, so this gate
 * is fast and safe to run anywhere, including CI.
 */
export default defineConfig({
  test: {
    root: HERE,
    include: ["test/**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    testTimeout: 20_000,
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
