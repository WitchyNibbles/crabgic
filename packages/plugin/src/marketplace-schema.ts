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
 * Git's null object ID — 40 hex zeros. It matches `FULL_GIT_SHA_PATTERN`
 * exactly, yet by definition names no object in any repository, so an
 * entry carrying it is an UNPINNED placeholder wearing a pin's shape. It
 * is rejected explicitly below (and named in the message) so a listing
 * that has never been cut at a real release commit can never be reported
 * as "SHA-pinned" — the precise falsehood a regex-only check let through.
 */
export const NULL_GIT_OBJECT_ID = "0".repeat(40);

const CommitPinSchema = z
  .string()
  .regex(FULL_GIT_SHA_PATTERN, "commit must be a full 40-hex-char git SHA, not a branch/tag ref")
  .refine((commit) => commit !== NULL_GIT_OBJECT_ID, {
    message:
      "commit is the all-zero placeholder (git's null object ID) — it resolves to no commit in " +
      "any repository, so the entry is NOT SHA-pinned; pin it to the real release commit",
  });

/**
 * This marketplace's own `name` field, byte-identical to
 * `.claude-plugin/marketplace.json`'s top-level `name` — the sole
 * definition site; `./enabled-plugin-key.ts` composes the real
 * `enabledPlugins` key from this constant rather than a second hand-typed
 * copy. `marketplace-schema.test.ts`'s own citation test fails if this
 * drifts from the committed file.
 */
export const MARKETPLACE_NAME = "crabgic-marketplace" as const;

/**
 * Optional discovery metadata the vendor's plugin-marketplace reference lists
 * as supported entry fields. Every one is optional, so an entry that predates
 * them still validates. There is deliberately NO `icon` member: the plugin
 * system has no icon field on either a marketplace entry or `plugin.json`, and
 * `.strict()` below must keep refusing one rather than carrying a key the
 * engine would ignore.
 *
 * `displayName` carries a documented minimum engine version of 2.1.143, which
 * the accepted range in `docs/engine-baseline.md` (2.1.207–2.1.220) clears at
 * its lower bound.
 */
const discoveryMetadataShape = {
  /** Human-readable name for UI surfaces; falls back to `name` when omitted. May contain spaces and capitals, unlike the kebab-case `name`. */
  displayName: z.string().min(1).optional(),
  author: z
    .object({
      name: z.string().min(1),
      email: z.string().min(1).optional(),
      url: z.string().min(1).optional(),
    })
    .strict()
    .optional(),
  homepage: z.string().min(1).optional(),
  repository: z.string().min(1).optional(),
  keywords: z.array(z.string().min(1)).optional(),
} as const;

/** Every plugin-entry field except `commit`, whose strictness is the one thing the two entry schemas below differ on. */
const pluginEntryCommonShape = {
  name: z.string().min(1),
  source: z.string().min(1),
  description: z.string().min(1),
  /**
   * The SOLE declared version for this plugin. Never mirror it into
   * `.claude-plugin/plugin.json`: per `docs/engine-baseline.md` §16 the
   * manifest's value silently outranks this one, which is how 1.0.0/1.0.1
   * shipped pinned to the manifest's `0.0.0` placeholder.
   */
  version: z.string().min(1),
  license: z.string().min(1),
  /** Content digest (`./content-digest.ts`), cross-checked against a vendored `--plugin-dir` install at install time. */
  digest: z.string().min(1),
  ...discoveryMetadataShape,
} as const;

export const MarketplacePluginEntrySchema = z
  .object({
    ...pluginEntryCommonShape,
    /** Full 40-hex-char git commit SHA that is not the null object ID — a branch/tag ref (e.g. "main") and the all-zero placeholder are both rejected, never an unpinned source. */
    commit: CommitPinSchema,
  })
  .strict();
export type MarketplacePluginEntry = z.infer<typeof MarketplacePluginEntrySchema>;

const UnpinnedPluginEntrySchema = z
  .object({
    ...pluginEntryCommonShape,
    commit: z
      .string()
      .regex(
        FULL_GIT_SHA_PATTERN,
        "commit must be a full 40-hex-char git SHA, not a branch/tag ref",
      ),
  })
  .strict();

/** Every marketplace-level field except `plugins`, whose entry strictness is the one thing the two marketplace schemas below differ on. */
const marketplaceCommonShape = {
  $schema: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  owner: z.object({ name: z.string().min(1), email: z.string().min(1) }).strict(),
} as const;

export const MarketplaceSchema = z
  .object({ ...marketplaceCommonShape, plugins: z.array(MarketplacePluginEntrySchema).min(1) })
  .strict();
export type Marketplace = z.infer<typeof MarketplaceSchema>;

/**
 * IDENTITY-ONLY variant of `MarketplaceSchema`: structurally identical
 * except that `commit` is allowed to be the all-zero placeholder. It
 * exists for the narrow set of callers that need a listing's IDENTITY
 * (marketplace `name`, plugin `name`, `digest`) out of a file that has not
 * yet been pinned at a release commit — e.g. this package's own
 * digest-freshness tests, and phase 23's marketplace-entry PREPARER, which
 * reads the committed file only as a template and computes the real
 * `commit` itself.
 *
 * NEVER use this to decide whether a plugin source is trustworthy or
 * release-ready: that is `MarketplaceSchema`'s job, and it deliberately
 * refuses the placeholder (see `NULL_GIT_OBJECT_ID`). A branch/tag ref is
 * rejected here too — the leniency is scoped to the placeholder alone.
 */
export const UnpinnedMarketplaceSchema = z
  .object({ ...marketplaceCommonShape, plugins: z.array(UnpinnedPluginEntrySchema).min(1) })
  .strict();
export type UnpinnedMarketplace = z.infer<typeof UnpinnedMarketplaceSchema>;

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

/** Reads and schema-validates `<pluginRoot>/.claude-plugin/marketplace.json`. Throws (via `.parse`) on any schema violation — including an entry left on the all-zero placeholder `commit`. Never silently coerces. */
export function loadMarketplace(pluginRoot: string): Marketplace {
  return MarketplaceSchema.parse(readMarketplaceJson(pluginRoot));
}

/** Reads and validates `<pluginRoot>/.claude-plugin/marketplace.json` against `UnpinnedMarketplaceSchema` — see that schema's own doc comment for the narrow set of callers this is for, and why it is never a trust/readiness decision. */
export function loadUnpinnedMarketplace(pluginRoot: string): UnpinnedMarketplace {
  return UnpinnedMarketplaceSchema.parse(readMarketplaceJson(pluginRoot));
}
