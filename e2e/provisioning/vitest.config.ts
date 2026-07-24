import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Default (non-`@live`) gate for the disposable-environment provisioning +
 * guaranteed-teardown harness (roadmap/23-release-hardening.md work item 2).
 *
 * Mirrors the repo root's `vitest.config.ts` convention: `*.live.test.ts` is
 * excluded here (it needs a real Docker daemon and boots a real Grafana OSS
 * container) and picked up only by `vitest.live.config.ts` /
 * `npm run provisioning:test:live`. Every other test in `test/` runs against
 * the injectable `ComposeRunner` interface via a fake/in-memory runner, so
 * this gate never touches Docker and is safe to run anywhere, including CI
 * without a daemon.
 */
export default defineConfig({
  test: {
    root: HERE,
    include: ["test/**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**", "**/*.live.test.ts"],
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      enabled: true,
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      // `src/live/**` (RealComposeRunner) is exercised only by the `@live`
      // integration test against a real Docker daemon, the same way this
      // repo's root `vitest.config.ts` exempts `packages/*/src/live/**`
      // from its own coverage denominator.
      exclude: ["**/dist/**", "**/*.d.ts", "**/*.config.*", "src/live/**", "src/index.ts"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
