import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Runner for this harness's `@live`-tagged conformance tests (roadmap/23
 * work item 7's "later wave" — the real pinned-engine turns): a genuine
 * `claude --version` pinned-range re-confirmation against the real host
 * engine, plus the hermeticity self-test's real `claude` spawn arm (03/06's
 * compiled-profile self-test, re-run here on a clean host). Needs
 * `EO_LIVE=1` and real auth — mirrors `packages/engine-claude/src/live`'s
 * `vitest.live.config.ts` in every load-bearing respect (sequential
 * execution, engine-scale timeouts, coverage disabled). Never run by the
 * default gate (`vitest.config.ts` excludes `**{/}*.live.test.ts`).
 */
export default defineConfig({
  test: {
    root: HERE,
    include: ["src/live/**/*.live.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 300_000,
    hookTimeout: 300_000,
    coverage: { enabled: false },
  },
});
