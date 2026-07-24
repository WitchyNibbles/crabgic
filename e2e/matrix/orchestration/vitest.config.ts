import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Orchestration-matrix harness — roadmap/23-release-hardening.md work item 4
 * ("Orchestration-matrix harness against 05/13 ... failing-test-first:
 * harness FAILs on a seeded duplicated side effect from a forced worker
 * crash"). Mirrors `e2e/report/vitest.config.ts` / `e2e/provisioning/
 * vitest.config.ts`'s own self-contained-project convention: this directory
 * is NOT wired into the root `vitest.config.ts`'s `test.projects` fan-out
 * (that file's own doc comment: "the orchestrator wires root refs at the
 * end") — it runs standalone via `npx vitest run e2e/matrix/orchestration`
 * (or `--config e2e/matrix/orchestration/vitest.config.ts`).
 *
 * Every scenario here drives the REAL `@eo/scheduler` executor
 * (`dispatchAttempt`/`resumeAttempt`) and the REAL `@eo/supervisor`
 * `recoverRun` against the FAKE engine (`@eo/testkit`'s `FakeEngineAdapter`)
 * over a real `@eo/journal` `JournalStore` on a real temp directory — no
 * network, no real Claude Code engine, no live Docker daemon, so this gate
 * is fast and safe to run anywhere, including CI.
 */
export default defineConfig({
  test: {
    root: HERE,
    // Both the scenario suite (`test/`) AND the colocated unit tests for
    // this harness's own `src/` support modules (evidence/targetDrift/
    // sideEffectSink/compiledProfile/testJournal) — the latter is what
    // makes the `coverage.include: ["src/**/*.ts"]` numbers below
    // meaningful at all; omitting `src/**/*.test.ts` here would silently
    // leave those unit tests never actually run while still being
    // instrumented for (0%) coverage.
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    // Fake-engine scenarios are fast (no real I/O beyond a temp-dir
    // journal); simulated-clock park/restart scenarios never real-sleep
    // (the roadmap's own constraint) so the default is generous only as a
    // safety margin, not because any scenario is expected to be slow.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      enabled: true,
      all: true,
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["**/dist/**", "**/*.d.ts", "**/*.config.*", "**/*.test.ts"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
