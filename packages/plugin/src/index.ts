/**
 * `@eo/plugin` public surface — roadmap/10-plugin-and-installer.md. This
 * package's real "product" is mostly non-TS: `.claude-plugin/plugin.json`,
 * `skills/*.md`, `agents/*.md`, `hooks/*` — loaded directly by a Claude Code
 * session, never imported. The TS surface below is the validation/build
 * tooling other packages (`@eo/cli`'s installer, this package's own tests)
 * need against those on-disk artifacts.
 */
export { resolvePluginRoot } from "./plugin-root.js";
export { parseFrontmatter, FrontmatterParseError, type ParsedFrontmatter } from "./frontmatter.js";
export {
  validatePluginManifest,
  REQUIRED_SKILL_NAMES,
  REQUIRED_SUBAGENT_NAMES,
  type ManifestFinding,
  type ManifestValidationResult,
} from "./plugin-manifest.js";
export { computeContentDigest, listPackagedFiles } from "./content-digest.js";
export {
  buildPluginCapabilityEntry,
  buildEngineCapabilityEntry,
  PLUGIN_CAPABILITY_NAME,
  type BuildPluginCapabilityEntryOptions,
} from "./capability-entry.js";
export {
  loadMarketplace,
  readMarketplaceJson,
  MarketplaceSchema,
  MarketplacePluginEntrySchema,
  MARKETPLACE_NAME,
  type Marketplace,
  type MarketplacePluginEntry,
} from "./marketplace-schema.js";
export {
  validateHooksManifest,
  HooksManifestSchema,
  ADVISORY_ONLY_EVENTS,
  type HooksManifestValidationResult,
} from "./hooks-manifest.js";
export { ENABLED_PLUGIN_KEY } from "./enabled-plugin-key.js";
