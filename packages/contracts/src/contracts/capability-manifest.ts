import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";

/**
 * A quarantine-pipeline decision, per
 * roadmap/12-stack-detection-quarantine.md §In scope, "Quarantine pipeline"
 * bullet (stage 6: "manifest entry for approval"): a candidate reaches the
 * manifest as `pending`, then a human `trust approve`/`trust review` call
 * (roadmap/12 §Interfaces produced, "CLI `trust review|approve|revoke`"
 * bullet) resolves it to `approved` or `rejected`.
 */
export const CAPABILITY_DECISIONS = ["pending", "approved", "rejected"] as const;
export const CapabilityDecisionSchema = z.enum(CAPABILITY_DECISIONS);
export type CapabilityDecision = z.infer<typeof CapabilityDecisionSchema>;

/**
 * Factory for the 5 "digest-pinned" entry kinds roadmap/11 names verbatim
 * (§In scope, "CapabilityManifest" bullet: "digest-pinned skills/plugins/
 * hooks/MCP servers/external tools"). Each shares the same shape: a
 * `digest` (the "digest-pinned" immutable pin roadmap/12 §Goal requires
 * before any capability "becomes a digest-pinned `CapabilityManifest`
 * entry"), an optional `sourceRef` (e.g. a marketplace commit SHA — 10 §In
 * scope, "Distribution" bullet: "marketplace repo (`marketplace.json`,
 * SHA-pinned)"), and the quarantine `decision`.
 */
function digestPinnedEntry<K extends string>(kind: K) {
  return z
    .object({
      kind: z.literal(kind),
      name: NonEmptyStringSchema,
      digest: NonEmptyStringSchema,
      sourceRef: NonEmptyStringSchema.optional(),
      decision: CapabilityDecisionSchema,
    })
    .strict();
}

export const SkillCapabilityEntrySchema = digestPinnedEntry("skill");
export const PluginCapabilityEntrySchema = digestPinnedEntry("plugin");
export const HookCapabilityEntrySchema = digestPinnedEntry("hook");
export const McpServerCapabilityEntrySchema = digestPinnedEntry("mcp_server");
export const ExternalToolCapabilityEntrySchema = digestPinnedEntry("external_tool");

/**
 * The pinned-engine entry. Field set — `engineVersion`, `supportsJsonSchema`,
 * `supportsSessionResume` — is drawn verbatim from
 * roadmap/06-claude-engine-adapter.md §Interfaces produced, "11" bullet:
 * "`EngineAdapter.capabilities()`'s `engineVersion`, `supportsJsonSchema`,
 * `supportsSessionResume` (field names per Gap 7), read at approval-preview
 * time to populate `CapabilityManifest`'s pinned-engine entry" — the same
 * 2 boolean field names interface-ledger Gap 7 settles for
 * `EngineCapabilities` (03/06's own type, not redefined here).
 */
export const EngineCapabilityEntrySchema = z
  .object({
    kind: z.literal("engine"),
    engineVersion: NonEmptyStringSchema,
    supportsJsonSchema: z.boolean(),
    supportsSessionResume: z.boolean(),
  })
  .strict();
export type EngineCapabilityEntry = z.infer<typeof EngineCapabilityEntrySchema>;

/**
 * The pinned-model entry, per docs/claude-code-adaptation.md:60 ("Pin full
 * IDs (`claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`,
 * `claude-fable-5`) in the CapabilityManifest; use aliases in scaffolded
 * config"). `role` is free text (e.g. "implementation", "architect",
 * "chore") — minimal shape chosen: the model-routing role vocabulary is
 * owned by 13's scheduler (roadmap/13-scheduler-packets-context.md §In
 * scope, "Model routing" bullet), not fixed as a closed union here.
 */
export const ModelCapabilityEntrySchema = z
  .object({
    kind: z.literal("model"),
    role: NonEmptyStringSchema,
    modelId: NonEmptyStringSchema,
  })
  .strict();
export type ModelCapabilityEntry = z.infer<typeof ModelCapabilityEntrySchema>;

export const CapabilityManifestEntrySchema = z.discriminatedUnion("kind", [
  SkillCapabilityEntrySchema,
  PluginCapabilityEntrySchema,
  HookCapabilityEntrySchema,
  McpServerCapabilityEntrySchema,
  ExternalToolCapabilityEntrySchema,
  EngineCapabilityEntrySchema,
  ModelCapabilityEntrySchema,
]);
export type CapabilityManifestEntry = z.infer<typeof CapabilityManifestEntrySchema>;

/**
 * `CapabilityManifest` (roadmap/02-contracts-and-schemas.md §Interfaces
 * produced, row "CapabilityManifest | 11, 12 (populates entries), 10
 * (plugin entry), 23"): assembled by 11 for a `ChangeSet` (`changeSetId`),
 * "folds in 12's quarantine entries and 10's own plugin manifest entry when
 * present — same graceful-degradation posture as `project.inspect`"
 * (roadmap/11 §In scope, "CapabilityManifest" bullet) — hence `entries` may
 * be empty before either phase populates it.
 */
export const CapabilityManifestSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,
    changeSetId: IdSchema,
    createdAt: TimestampSchema,
    entries: z.array(CapabilityManifestEntrySchema),
  })
  .strict();
export type CapabilityManifest = z.infer<typeof CapabilityManifestSchema>;
