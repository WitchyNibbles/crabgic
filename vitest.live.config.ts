import { defineConfig } from "vitest/config";

/**
 * Runner for the `@live`-tagged conformance suite (roadmap/06, ledger
 * Gap 15): `packages/engine-claude/src/live/*.live.test.ts` replayed against
 * the real, pinned Claude Code engine. Invoked by `npm run test:live` and the
 * `engine-live` CI job — never by the default gate (`vitest.config.ts`
 * excludes `**{/}*.live.test.ts`).
 *
 * Design constraints, per `docs/engine-baseline.md`:
 * - Live tests require real auth (baseline §1) and consume the owner's
 *   subscription — the suite's own harness refuses to start unless
 *   `EO_LIVE=1` is set, and rate-limit-guards itself via the
 *   `rate_limit_event` stream (baseline §8).
 * - `fileParallelism: false` + sequential execution: concurrent engine
 *   spawns would multiply subscription load and interleave session probes.
 * - Timeouts are engine-scale (a live turn can take minutes), not the
 *   default gate's 20s.
 * - Coverage thresholds are the default gate's job; the live job asserts
 *   engine behavior, not line coverage.
 */
export default defineConfig({
  test: {
    include: ["packages/engine-claude/src/live/**/*.live.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**", "**/.git/**"],
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 300_000,
    hookTimeout: 300_000,
    coverage: { enabled: false },
  },
});
