import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * roadmap/23-release-hardening.md work item 6: neutral-communication +
 * connector-security + exactly-once matrix harness. Self-contained project
 * (own tsconfig + vitest config), mirroring `e2e/provisioning/`'s own
 * convention — NOT wired into the root `vitest.config.ts`'s `test.projects`
 * fan-out (that file's own doc comment deliberately excludes
 * `e2e/provisioning/`; this project follows the identical pattern for
 * `e2e/matrix/connector/`). Run directly via
 * `npx vitest run --config e2e/matrix/connector/vitest.config.ts` (or the
 * `matrix:connector:test` root script, once wired by whichever phase-23
 * work item owns root script additions — this project itself never edits
 * root config per its own constraints).
 *
 * Every test here drives REAL `@crabgic/gateway`/`@crabgic/renderer`/
 * `@crabgic/connectors-jira`/`@crabgic/connectors-grafana` logic (imported from their
 * built `dist/` output, like any other cross-package import in this repo —
 * `npm run build` must have run first, exactly as CI's own `test` job does
 * before `npm test`) against fakes/cassettes/synthetic fixtures — never a
 * live network call, matching this repo's own no-live-network-calls
 * convention for non-`@live` suites.
 */
export default defineConfig({
  test: {
    root: HERE,
    include: ["src/**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      enabled: true,
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "**/dist/**",
        "**/*.d.ts",
        "**/*.config.*",
        "src/**/*.test.ts",
        // Crash-recovery kill-harness fixtures are plain .mjs child
        // processes spawned by `runKillHarness` (mirroring
        // `packages/gateway/src/mutation-pipeline/kill-harness-fixtures/`'s
        // own precedent) — exercised as a real separate process, not
        // instrumentable by this project's own v8 coverage collector, and
        // exempted from the denominator the same way that sibling
        // directory's fixtures are never claimed as this package's own
        // covered lines.
        "src/exactly-once/fixtures/**",
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
