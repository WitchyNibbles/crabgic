/**
 * `CapabilityManifest` builder — roadmap/11-intake-contract-approval.md §In
 * scope, "CapabilityManifest" bullet: "digest-pinned skills/plugins/hooks/
 * MCP servers/external tools; folds in 12's quarantine entries and 10's own
 * plugin manifest entry when present — same graceful-degradation posture
 * as `project.inspect`."
 *
 * Kept dependency-free of `packages/detect` and `packages/plugin` on
 * purpose (this package, `@eo/supervisor`, must never depend on either —
 * `packages/detect` depends on `packages/cli`, which depends on
 * `@eo/supervisor`; a `@eo/supervisor -> @eo/detect` edge would close a
 * cycle, and `@eo/plugin` is likewise a `packages/cli` dependency this
 * package doesn't need for its own build). Every entry this builder folds
 * in — the engine entry, the plugin entry, 12's quarantine entries, the
 * model roster — is supplied already-built by the caller (`packages/cli`'s
 * orchestration layer, which DOES depend on `@eo/plugin` and can read
 * `packages/detect`'s on-disk capability-store JSON directly without a
 * package-level dependency edge). This keeps the "graceful degradation"
 * posture: any of the four sources may be omitted (empty array/undefined)
 * and the manifest still builds, matching `project.inspect`'s same
 * before-12/before-10 tolerance.
 *
 * MEDIUM M3 repair (adversarial-validation finding): roadmap/11 §Interfaces
 * consumed, "From 06": "`EngineAdapter.capabilities()` — ... read at
 * approval-preview time to populate `CapabilityManifest`'s pinned-engine
 * entry." The engine entry was previously 100% caller-injected as a
 * fixture literal, with no actual `capabilities()` call anywhere in this
 * phase's own trees. `engineAdapter` below accepts anything satisfying
 * `Pick<EngineAdapter, "capabilities">` (`@eo/engine-core` — already this
 * package's own dependency, not a new one) and DERIVES the pinned-engine
 * entry from calling it for real; `engineEntry` remains as a literal
 * fallback for a caller with no adapter handle at all, but `engineAdapter`
 * always takes priority when both are supplied.
 */
import {
  CapabilityManifestSchema,
  CURRENT_SCHEMA_VERSION,
  type CapabilityManifest,
  type CapabilityManifestEntry,
  type EngineCapabilityEntry,
  type ModelCapabilityEntry,
} from "@eo/contracts";
import type { EngineAdapter } from "@eo/engine-core";

export interface BuildCapabilityManifestOptions {
  readonly id: string;
  readonly changeSetId: string;
  readonly createdAt: string;
  /**
   * A real `EngineAdapter` (or anything exposing just its `capabilities()`
   * method) — when supplied, the pinned-engine entry is derived by
   * actually CALLING `.capabilities()` (MEDIUM M3 repair), reading
   * `engineVersion`/`supportsJsonSchema`/`supportsSessionResume` off its
   * live return value. Takes priority over `engineEntry` when both are
   * supplied.
   */
  readonly engineAdapter?: Pick<EngineAdapter, "capabilities">;
  /** Literal pinned-engine entry fallback for a caller with no adapter handle at all (e.g. this phase's own golden fixture, pre-06-integration test doubles). Ignored when `engineAdapter` is supplied. */
  readonly engineEntry?: EngineCapabilityEntry;
  /** 10's own plugin manifest entry (`buildPluginCapabilityEntry`, `@eo/plugin`), supplied pre-built by the caller. */
  readonly pluginEntry?: CapabilityManifestEntry;
  /** 12's quarantine-pipeline entries (skill/hook/mcp_server/external_tool), read from the on-disk capability store by the caller — empty/absent before 12 has audited anything. */
  readonly quarantineEntries?: readonly CapabilityManifestEntry[];
  /** The roster's role -> model pins (13 resolves the alias map; 11 only records the pin roadmap/11's own approval render shows the human). */
  readonly modelRoster?: readonly ModelCapabilityEntry[];
}

/** Derives the pinned-engine `CapabilityManifestEntry` from a real `EngineAdapter.capabilities()` call — the 3 fields `CapabilityManifest`'s `EngineCapabilityEntrySchema` carries, per interface-ledger Gap 7. */
function buildEngineEntryFromAdapter(
  adapter: Pick<EngineAdapter, "capabilities">,
): EngineCapabilityEntry {
  const capabilities = adapter.capabilities();
  return {
    kind: "engine",
    engineVersion: capabilities.engineVersion,
    supportsJsonSchema: capabilities.supportsJsonSchema,
    supportsSessionResume: capabilities.supportsSessionResume,
  };
}

/** Builds a schema-valid `CapabilityManifest`, folding in whichever of the four optional entry sources the caller supplies — never throws for every source being absent (fresh-repo / pre-12 / pre-10 case). */
export function buildCapabilityManifest(
  options: BuildCapabilityManifestOptions,
): CapabilityManifest {
  const engineEntry =
    options.engineAdapter !== undefined
      ? buildEngineEntryFromAdapter(options.engineAdapter)
      : options.engineEntry;

  const entries: CapabilityManifestEntry[] = [
    ...(engineEntry !== undefined ? [engineEntry] : []),
    ...(options.pluginEntry !== undefined ? [options.pluginEntry] : []),
    ...(options.quarantineEntries ?? []),
    ...(options.modelRoster ?? []),
  ];

  const manifest: CapabilityManifest = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: options.id,
    changeSetId: options.changeSetId,
    createdAt: options.createdAt,
    entries,
  };
  return CapabilityManifestSchema.parse(manifest);
}
