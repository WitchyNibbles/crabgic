import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Release-cut attestation harness — the emitters for the seven
 * `RELEASE_GATE_CHECKLIST` items that no other `e2e/` harness reports on.
 *
 * The existing matrix harnesses (`e2e/matrix/*`, `e2e/live`, `e2e/release`)
 * each prove a property by EXERCISING a subsystem against live/containerized
 * infrastructure. The seven items collected here are different in kind: each
 * one attests to a property of the release candidate's own committed state
 * (its docs, its journal, its traceability, its platform coverage) rather
 * than to a subsystem's runtime behaviour. That is precisely why no harness
 * emitted for them — they fall outside every matrix's remit — and why they
 * belong in one project instead of seven near-empty ones.
 *
 * Every check here is REAL: it reads the actual repository/journal state and
 * reports the verdict it finds. None of them fabricates a PASS when the
 * underlying release work has not happened — a missing sign-off, an
 * un-refreshed vendor support window, or an untraced requirement produces a
 * genuine non-zero `exitStatus` in the emitted `EvidenceRecord`, exactly as
 * `e2e/report/src/schema.ts`'s "PASS is NEVER the generator's default"
 * invariant requires.
 *
 * Safe to run unconditionally: every check is read-only against the repo
 * (`git ls-files`/`git log`/file reads), except the demo-handoff check,
 * which builds a disposable throwaway repository under `os.tmpdir()` and
 * never touches this checkout or any remote. Mirrors `e2e/release/`'s
 * self-contained-project convention (own tsconfig + vitest config, run
 * standalone rather than through the root `vitest.config.ts` fan-out).
 */
export default defineConfig({
  test: {
    root: HERE,
    include: ["src/**/*.test.ts"],
    // `*.live.test.ts` boots a real Grafana OSS container via `docker
    // compose` (the containerized requirement-traceability binding); it is
    // picked up only by `vitest.live.config.ts`, exactly as
    // `e2e/provisioning` and the repo root already do for their own
    // `@live` suites.
    exclude: ["**/dist/**", "**/node_modules/**", "**/*.live.test.ts"],
    testTimeout: 120_000,
    coverage: {
      provider: "v8",
      enabled: true,
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      // Only the ONE live helper that genuinely cannot run without a Docker
      // daemon is exempt from the denominator (mirroring
      // `e2e/provisioning/vitest.config.ts`). Its siblings —
      // `live/tlsFrontedContainer.ts`, `live/basicAuth.ts`,
      // `live/selfSignedCert.ts` — need only `openssl` and loopback, exactly
      // like `packages/gateway/src/transport/http-transport.test.ts`, so they
      // ARE measured here and carry their own unit tests. A blanket
      // `src/live/**` exclusion let ~380 lines ship untested.
      exclude: [
        "**/dist/**",
        "**/*.d.ts",
        "**/*.config.*",
        "src/live/grafanaTraceabilityBinding.ts",
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
