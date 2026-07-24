/**
 * `marketplace.json` schema — roadmap/10-plugin-and-installer.md §In scope,
 * "Distribution": "marketplace repo (`marketplace.json`, SHA-pinned)."
 * Work item 8's first failing test: "marketplace-listing schema validation
 * currently passes an unpinned (branch-ref) entry that must fail" — the
 * `commit` field below is validated as a full 40-hex-character git commit
 * SHA specifically so a friendly ref like `"main"`/`"HEAD"` is rejected.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const FULL_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * This marketplace's own `name` field, byte-identical to
 * `.claude-plugin/marketplace.json`'s top-level `name` — the sole
 * definition site; `./enabled-plugin-key.ts` composes the real
 * `enabledPlugins` key from this constant rather than a second hand-typed
 * copy. `marketplace-schema.test.ts`'s own citation test fails if this
 * drifts from the committed file.
 */
export const MARKETPLACE_NAME = "engineering-orchestrator-marketplace" as const;

export const MarketplacePluginEntrySchema = z
  .object({
    name: z.string().min(1),
    source: z.string().min(1),
    description: z.string().min(1),
    version: z.string().min(1),
    license: z.string().min(1),
    /** Full 40-hex-char git commit SHA — a branch/tag ref (e.g. "main") is rejected, never an unpinned source. */
    commit: z
      .string()
      .regex(
        FULL_GIT_SHA_PATTERN,
        "commit must be a full 40-hex-char git SHA, not a branch/tag ref",
      ),
    /** Content digest (`./content-digest.ts`), cross-checked against a vendored `--plugin-dir` install at install time. */
    digest: z.string().min(1),
  })
  .strict();
export type MarketplacePluginEntry = z.infer<typeof MarketplacePluginEntrySchema>;

export const MarketplaceSchema = z
  .object({
    $schema: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    owner: z.object({ name: z.string().min(1), email: z.string().min(1) }).strict(),
    plugins: z.array(MarketplacePluginEntrySchema).min(1),
  })
  .strict();
export type Marketplace = z.infer<typeof MarketplaceSchema>;

/**
 * Reads and JSON-parses `<pluginRoot>/.claude-plugin/marketplace.json`
 * WITHOUT schema validation. Throws only on a missing file or invalid JSON —
 * NOT on a schema/SHA-pin violation. This lets a caller (e.g. the
 * `plugin-trust-pin` doctor check) apply `MarketplaceSchema` itself and thereby
 * distinguish "unreadable/malformed file" from "readable but not SHA-pinned",
 * giving the right repair guidance for each.
 */
export function readMarketplaceJson(pluginRoot: string): unknown {
  const raw = readFileSync(join(pluginRoot, ".claude-plugin", "marketplace.json"), "utf8");
  return JSON.parse(raw);
}

/** Reads and schema-validates `<pluginRoot>/.claude-plugin/marketplace.json`. Throws (via `.parse`) on any schema violation — never silently coerces. */
export function loadMarketplace(pluginRoot: string): Marketplace {
  return MarketplaceSchema.parse(readMarketplaceJson(pluginRoot));
}
