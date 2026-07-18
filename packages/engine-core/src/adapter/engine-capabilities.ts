/**
 * `EngineCapabilities` — `EngineAdapter.capabilities()`'s return type.
 * EXACTLY these five fields, no more, no fewer (interface-ledger Gap 7:
 * "the adaptation doc's names win: `capabilities()` returns exactly
 * `supportsJsonSchema, supportsSessionResume, permissionModel,
 * sandboxModel, engineVersion`. Phase 03's earlier `structuredOutput`/
 * `sessionResume` are retired and must never be reintroduced.").
 */
export interface EngineCapabilities {
  /** Whether this engine supports `--json-schema`/`Options.outputFormat` schema-validated `structured_output` (adaptation §4.4). */
  readonly supportsJsonSchema: boolean;
  /** Whether this engine supports `--resume`/`Options.resume` session continuation (adaptation §4.5). */
  readonly supportsSessionResume: boolean;
  /** A label identifying the permission-enforcement model this engine implements (e.g. the `dontAsk` deny-by-default model, adaptation §4.1). */
  readonly permissionModel: string;
  /** A label identifying the sandbox model this engine implements (e.g. bubblewrap+socat on Linux/WSL2, adaptation §4.2). */
  readonly sandboxModel: string;
  /** The engine's own version string (docs/engine-baseline.md's pinned/accepted range is checked against this). */
  readonly engineVersion: string;
}

/**
 * Field-exhaustiveness mechanism (Gap 7's own five-field list; mirrors
 * `packages/contracts/src/journal/journal-entry-type.ts`'s
 * `Record<K, string>` trick): a `Record<keyof EngineCapabilities, string>`
 * descriptor literal is valid TypeScript only when it declares EXACTLY one
 * property per interface field — TS's excess/missing-property checking on
 * an object literal assigned to a `Record<K, V>`-typed binding rejects
 * both a missing key (an uncovered field) and a stray extra key. Adding a
 * 6th field to `EngineCapabilities` without a matching key here fails
 * `npx tsc -b packages/engine-core`; so does the reverse (a stray key with
 * no corresponding field).
 */
export const ENGINE_CAPABILITIES_FIELD_DESCRIPTIONS: Readonly<
  Record<keyof EngineCapabilities, string>
> = {
  supportsJsonSchema: "Schema-validated structured_output support (adaptation §4.4).",
  supportsSessionResume: "--resume/Options.resume session continuation support (adaptation §4.5).",
  permissionModel:
    "Label identifying the permission-enforcement model in effect (adaptation §4.1).",
  sandboxModel: "Label identifying the OS sandbox model in effect (adaptation §4.2).",
  engineVersion: "The engine's own reported version string (docs/engine-baseline.md pinned range).",
};

export const ENGINE_CAPABILITIES_FIELD_NAMES = Object.freeze(
  Object.keys(ENGINE_CAPABILITIES_FIELD_DESCRIPTIONS).sort(),
) as readonly string[];
