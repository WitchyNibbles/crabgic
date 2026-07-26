import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Installation-matrix harness — roadmap/23-release-hardening.md work item 3
 * ("Installation-matrix harness against 10 ... failing-test-first: harness
 * FAILs on a seeded fixture where the installer silently overwrites a user
 * edit"). Mirrors `e2e/report/vitest.config.ts` / `e2e/provisioning/
 * vitest.config.ts`'s own self-contained-project convention: this directory
 * is NOT wired into the root `vitest.config.ts`'s `test.projects` fan-out —
 * it runs standalone via `npx vitest run e2e/matrix/installation` (or
 * `--config e2e/matrix/installation/vitest.config.ts`).
 *
 * Every scenario here drives the REAL `packages/cli` install/upgrade/
 * uninstall backend (`parseCommand` + `dispatchCommand`, exactly the public
 * surface a real invocation of the `crabgic` binary uses)
 * against REAL throwaway temp git repos (real `git` child processes via
 * `@crabgic/git-engine`'s `createGitPlumbing` — no shell, no mocked plumbing) and
 * a REAL `@crabgic/journal` `JournalStore` for this harness's own evidence
 * emission. No network, no live Docker daemon, so this gate is fast and
 * safe to run anywhere, including CI.
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
