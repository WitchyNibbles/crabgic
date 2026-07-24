import { execFile as execFileCb } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  computeContentDigest,
  MarketplacePluginEntrySchema,
  MarketplaceSchema,
  type Marketplace,
  type MarketplacePluginEntry,
} from "@eo/plugin";

const execFile = promisify(execFileCb);

/**
 * Marketplace-entry PREPARER — roadmap/23-release-hardening.md work item
 * 10: "a `marketplace.json` entry PREPARER (SHA computed from HEAD, using
 * 10's mechanism/schema — prepare the entry, don't cut/publish it)."
 * PREPARE-DON'T-PUBLISH (owner decision): this module returns a validated
 * `MarketplacePluginEntry` object; it NEVER writes to the real, committed
 * `packages/plugin/.claude-plugin/marketplace.json`. Reuses 10's own
 * mechanism/schema verbatim (`@eo/plugin`'s `computeContentDigest` +
 * `MarketplacePluginEntrySchema`) — never a second, parallel
 * digest/schema implementation.
 */

/** Injectable seam over `git rev-parse HEAD` — mirrors this project's other real/fake process-call seams. */
export type GitRevParseFn = (repoRoot: string, commitIsh: string) => Promise<string>;

export const realGitRevParse: GitRevParseFn = async (repoRoot, commitIsh) => {
  const { stdout } = await execFile("git", ["rev-parse", commitIsh], { cwd: repoRoot });
  return stdout.trim();
};

export interface PrepareMarketplaceEntryOptions {
  /** `packages/plugin` — the plugin root `computeContentDigest` hashes and whose existing `.claude-plugin/marketplace.json` supplies every field this preparer does NOT recompute (name, source, description, license). */
  readonly pluginRoot: string;
  readonly repoRoot: string;
  /** The release version to prepare, e.g. `"1.0.0"`. */
  readonly version: string;
  readonly gitRevParse?: GitRevParseFn;
  /** `"HEAD"` by default — the commit the release-candidate object ID is cut from. */
  readonly commitIsh?: string;
}

/**
 * Reads the existing, committed `marketplace.json`'s single plugin entry
 * as a template, then returns a NEW `MarketplacePluginEntry` with
 * `version` set to `options.version`, `commit` set to the real (or
 * injected) `git rev-parse` of `options.commitIsh`, and `digest`
 * recomputed via `computeContentDigest` — schema-validated
 * (`MarketplacePluginEntrySchema.parse`, which rejects a non-full-SHA
 * `commit` the same way 10's own work item 8 test does) before being
 * returned. Never writes any file.
 */
export async function prepareMarketplaceEntry(
  options: PrepareMarketplaceEntryOptions,
): Promise<MarketplacePluginEntry> {
  const existingRaw = readFileSync(
    join(options.pluginRoot, ".claude-plugin", "marketplace.json"),
    "utf8",
  );
  const existing = MarketplaceSchema.parse(JSON.parse(existingRaw));
  // `MarketplaceSchema` itself enforces `plugins.length >= 1`
  // (`z.array(...).min(1)`), so `existing.plugins[0]` having just passed
  // schema validation guarantees this is defined — the non-null assertion
  // documents that invariant rather than adding an unreachable, untestable
  // defensive branch for a case the schema already rules out.
  const template = existing.plugins[0]!;

  const gitRevParse = options.gitRevParse ?? realGitRevParse;
  const commit = await gitRevParse(options.repoRoot, options.commitIsh ?? "HEAD");
  const digest = computeContentDigest(options.pluginRoot);

  const prepared: MarketplacePluginEntry = {
    ...template,
    version: options.version,
    commit,
    digest,
  };
  return MarketplacePluginEntrySchema.parse(prepared);
}

/** Renders what the FULL `marketplace.json` file would look like with `preparedEntry` substituted in for the existing template entry — for review/reporting only; still never written to disk by this module. */
export function renderPreparedMarketplace(
  existing: Marketplace,
  preparedEntry: MarketplacePluginEntry,
): Marketplace {
  return MarketplaceSchema.parse({
    ...existing,
    plugins: existing.plugins.map((entry) =>
      entry.name === preparedEntry.name ? preparedEntry : entry,
    ),
  });
}
