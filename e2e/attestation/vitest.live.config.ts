import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Runner for this harness's `@live`-tagged containerized suite — the
 * requirement-traceability binding (roadmap/23's "Every requirement linked
 * to evidence from the exact final Git object ID and remote (Jira/Grafana)
 * revisions" exit criterion, and roadmap/21 work items 1-2).
 *
 * It boots `docker/grafana/11.6/docker-compose.yml` for real, fronts it with
 * TLS, drives a real dashboard mutation through the real `executeMutationPlan`
 * pipeline, and writes `docs/evidence/phase-23/requirement-traceability.json`
 * from the confirmed `MutationApplyResult.appliedRevision`. Needs a live
 * Docker daemon, so it is never run by the default gate
 * (`vitest.config.ts` excludes `**{/}*.live.test.ts`).
 *
 * Mirrors `e2e/provisioning/vitest.live.config.ts` exactly: serial, generous
 * timeouts, coverage off (a container boot is not a coverage measurement).
 */
export default defineConfig({
  test: {
    root: HERE,
    include: ["src/**/*.live.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 300_000,
    hookTimeout: 300_000,
    coverage: { enabled: false },
  },
});
