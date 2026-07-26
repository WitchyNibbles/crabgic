import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * `@live` full-system conformance HARNESS — roadmap/23-release-hardening.md
 * work item 7. This is the default (non-`@live`) gate: pinned-range-gate
 * logic, the sandbox self-test (real `bwrap`, no engine/auth needed — a
 * genuine "clean host" self-test that is safe to run anywhere), the
 * gateway-MCP 8-family completeness check, and the zero-`NOT_IMPLEMENTED`
 * sweep. Every one of these runs for real against this repo's own
 * `packages/cli`/`packages/gateway` source — no fake engine substitution —
 * but none of them spends a live Claude Code turn or touches the network,
 * so this gate is fast, deterministic-enough, and CI-safe.
 *
 * Mirrors `e2e/report/vitest.config.ts` / `e2e/provisioning/vitest.config
 * .ts`'s self-contained-project convention: this directory is NOT wired
 * into the root `vitest.config.ts`'s `test.projects` fan-out. Run standalone
 * via `npx vitest run e2e/live` (or `--config e2e/live/vitest.config.ts`).
 *
 * `*.live.test.ts` under `src/live/` is excluded here — those spend a real
 * Claude Code turn against the pinned engine and are picked up only by
 * `vitest.live.config.ts` (`CRABGIC_LIVE=1`), matching
 * `packages/engine-claude/src/live/*.live.test.ts`'s own convention.
 */
export default defineConfig({
  test: {
    root: HERE,
    include: ["src/**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**", "**/*.live.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      enabled: true,
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["**/dist/**", "**/*.d.ts", "**/*.config.*", "src/live/**"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
