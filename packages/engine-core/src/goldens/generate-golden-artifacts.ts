import { compileEnvelope } from "../compiler/compile-envelope.js";
import { CANONICAL_ENVELOPE_CASES } from "./canonical-envelopes.js";

/** One committed golden file's relative path (under `packages/engine-core/goldens/`) and its exact content. */
export interface GoldenArtifact {
  readonly relativePath: string;
  readonly content: string;
}

/**
 * `JSON.stringify(value, null, 2)` plus exactly one trailing newline —
 * mirrors `packages/contracts/scripts/build-schemas.ts`'s own determinism
 * convention (roadmap/03 §In scope: "emitted by a small deterministic
 * script or test helper … JSON.stringify(...,null,2)+trailing newline,
 * stable key order").
 */
function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Builds all six golden artifacts (2 serializations x 3 canonical
 * envelopes) purely in-memory — deterministic, no filesystem I/O. Key
 * order is stable because every compiled object's fields are always
 * constructed in the same fixed order (`compiled-worker-profile.ts`'s own
 * object literals), and array order is stable because it is always driven
 * by the same fixed `CANONICAL_ENVELOPE_CASES`/envelope-array iteration
 * order — never `Object.keys` iteration over a mutable structure.
 */
export function buildGoldenArtifacts(): readonly GoldenArtifact[] {
  return CANONICAL_ENVELOPE_CASES.flatMap(({ name, envelope }) => {
    const compiled = compileEnvelope(envelope);
    return [
      { relativePath: `${name}.settings.json`, content: serialize(compiled.settingsJson) },
      { relativePath: `${name}.sdk-options.json`, content: serialize(compiled.sdkOptions) },
    ];
  });
}
