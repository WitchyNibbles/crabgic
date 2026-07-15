import { defineConfig } from "vitest/config";

// Phase 01 (work item 3): single root Vitest config using `test.projects` to
// fan out across every workspace package (Vitest 4's replacement for the
// deprecated standalone `vitest.workspace.ts` file). Coverage is v8-based
// with an 80% line+branch (+function+statement) gate enforced globally.
// At this phase the 18 packages are empty stubs with no test files, so the
// gate has nothing to measure yet — `passWithNoTests` keeps that state green.
// The gate's bite is demonstrated separately via a temporary fixture package
// (see docs/evidence/phase-01/wi3-*) and then removed.
export default defineConfig({
  test: {
    projects: ["packages/*"],
    passWithNoTests: true,
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
