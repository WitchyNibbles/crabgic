import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Runner for the provisioning harness's single `@live`-tagged integration
 * test (roadmap/23-release-hardening.md work item 2): boots a real Grafana
 * OSS container via the real `RealComposeRunner` (actual `docker compose`
 * child-process calls, no fake), hits `/api/health`, and tears down. Needs a
 * live Docker daemon — never run by the default gate
 * (`vitest.config.ts` excludes `**{/}*.live.test.ts`).
 */
export default defineConfig({
  test: {
    root: HERE,
    include: ["test/**/*.live.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    coverage: { enabled: false },
  },
});
