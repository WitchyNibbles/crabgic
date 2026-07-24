/**
 * Builds this plugin's own `CapabilityManifest` entries — roadmap/10-plugin-
 * and-installer.md §Interfaces produced: "A CapabilityManifest entry for the
 * plugin itself (digest-pinned; schema owned by 02) — one entry in the
 * manifest 11 assembles." §Interfaces consumed, 06: "Tested Claude Code
 * baseline version range ... reused (not re-derived) ... for ... the
 * plugin's CapabilityManifest version pin" — the engine entry below
 * reuses `@eo/engine-claude`'s own constants directly rather than
 * duplicating them (unlike `packages/cli`'s pre-existing `doctor/checks/
 * engine-version.ts`, which deliberately does NOT import `@eo/engine-claude`
 * per 09's own governing instructions — this is a different, later phase's
 * explicit reuse instruction, not a contradiction of that one).
 */
import { z } from "zod";
import {
  PluginCapabilityEntrySchema,
  EngineCapabilityEntrySchema,
  type EngineCapabilityEntry,
} from "@eo/contracts";
import { TESTED_ENGINE_VERSION } from "@eo/engine-claude";
import { computeContentDigest } from "./content-digest.js";

/** `@eo/contracts` exports the schema but not a standalone named type for this one entry kind (only the discriminated union has a name) — derived locally rather than widening the import surface there. */
export type PluginCapabilityEntry = z.infer<typeof PluginCapabilityEntrySchema>;

export const PLUGIN_CAPABILITY_NAME = "engineering-orchestrator";

export interface BuildPluginCapabilityEntryOptions {
  readonly pluginRoot: string;
  readonly sourceRef?: string;
}

/** Builds the digest-pinned `plugin` entry, schema-validated against `@eo/contracts`'s `PluginCapabilityEntrySchema`. Starts `pending` — quarantine review (12) resolves it to `approved`/`rejected`; this phase never self-approves. */
export function buildPluginCapabilityEntry(
  options: BuildPluginCapabilityEntryOptions,
): PluginCapabilityEntry {
  const entry: PluginCapabilityEntry = {
    kind: "plugin",
    name: PLUGIN_CAPABILITY_NAME,
    digest: computeContentDigest(options.pluginRoot),
    decision: "pending",
    ...(options.sourceRef !== undefined ? { sourceRef: options.sourceRef } : {}),
  };
  return PluginCapabilityEntrySchema.parse(entry);
}

/**
 * Builds the pinned-engine entry this plugin was verified against, reusing
 * `@eo/engine-claude`'s `TESTED_ENGINE_VERSION` and the same
 * `supportsJsonSchema`/`supportsSessionResume` capability booleans its own
 * `ClaudeEngineAdapter.capabilities()` reports (06's `adapter.ts`).
 */
export function buildEngineCapabilityEntry(): EngineCapabilityEntry {
  const entry: EngineCapabilityEntry = {
    kind: "engine",
    engineVersion: TESTED_ENGINE_VERSION,
    supportsJsonSchema: true,
    supportsSessionResume: true,
  };
  return EngineCapabilityEntrySchema.parse(entry);
}
