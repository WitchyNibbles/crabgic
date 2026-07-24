/**
 * Canonical hashing — roadmap/11-intake-contract-approval.md §In scope,
 * "AuthorizationEnvelope" bullet: "canonical hash-stable form"; §Test plan,
 * Unit: "canonical-hash stability and perturbation-sensitivity of
 * `AuthorizationEnvelope`". This module is the single shared primitive
 * every 11 builder (`envelope-builder.ts`, `capability-manifest-builder.ts`,
 * the provisional `PerformanceContract` budget hash) uses to derive a
 * stable digest from a JSON-shaped value: object keys are sorted
 * recursively before serialization, so two structurally-identical values
 * with keys inserted in a different order still hash identically, and any
 * one-field content change (including array element order, which this
 * function deliberately does NOT normalize — array order is part of the
 * envelope's own meaning, e.g. `ownedPaths`) changes the digest.
 */
import { createHash } from "node:crypto";

/**
 * Any JSON-serializable value. Deliberately typed `unknown` at the public
 * boundary (rather than a closed recursive JSON-value union) so every
 * caller's own already-zod-validated contract shape (e.g.
 * `AuthorizationEnvelopeContent`, a `ProvisionalPerformanceBudgetEntry[]`)
 * can be passed directly with no manual widening/casting at every call
 * site — the recursive union previously here rejected concrete object
 * types with a fixed property set (no index signature), which every real
 * caller in this phase has. Runtime behavior is unaffected: an
 * `undefined`-valued object property is omitted (matching
 * `JSON.stringify`'s own semantics) rather than serialized.
 */
export type CanonicalJsonValue = unknown;

/**
 * Deterministically serializes `value` with every object's keys sorted
 * (recursively). Arrays keep their given order — order is semantically
 * meaningful for this system's own fields (e.g. `ownedPaths`,
 * `integrationOrder`), so this function must not silently reorder it.
 */
export function canonicalStringify(value: CanonicalJsonValue): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stringify(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((key) => obj[key] !== undefined)
      .sort();
    const body = keys.map((key) => `${JSON.stringify(key)}:${stringify(obj[key])}`).join(",");
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 hex digest of `canonicalStringify(value)`, prefixed `sha256:` (matching this repo's own digest-string convention, e.g. `packages/detect`'s `computeCandidateDigest`). */
export function canonicalHash(value: CanonicalJsonValue): string {
  const digest = createHash("sha256").update(canonicalStringify(value)).digest("hex");
  return `sha256:${digest}`;
}
