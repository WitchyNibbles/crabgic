/**
 * Canonical hashing — the single shared primitive for deriving a stable
 * digest from a JSON-shaped value: object keys are sorted recursively before
 * serialization, so two structurally-identical values with keys inserted in a
 * different order still hash identically, and any one-field content change
 * (including array element order, which this function deliberately does NOT
 * normalize — array order is part of the meaning of fields like `ownedPaths`,
 * `integrationOrder`, and a requirement's ordered acceptance criteria)
 * changes the digest.
 *
 * It lives here, in the base package, because three consumers now need it and
 * two of them had already duplicated it: roadmap/11's intake builders
 * (`AuthorizationEnvelope` content hash, capability manifest, provisional
 * performance budgets), roadmap/15's budget hash-link check, and roadmap/24's
 * acceptance-criteria seal. The two pre-existing copies each carried a header
 * explaining the duplication was deliberate "because there is no P11 → P15
 * dependency edge" — true, but both packages depend on `@crabgic/contracts`,
 * so the edge that removes the duplication already existed. They now
 * re-export this module and keep their own tests pointed at their own paths,
 * which is what proves the consolidation changed no behavior.
 *
 * Deliberately NOT the same function as `@crabgic/journal`'s
 * `codec/hash-chain.ts` `canonicalize`, which produces a BARE hex digest for
 * the append-only entry chain and throws on non-finite numbers. Two digest
 * formats coexist on purpose: `sha256:`-prefixed for content addressing,
 * bare hex for chain linkage. A seal or content digest uses this one.
 */
import { createHash } from "node:crypto";

/**
 * Any JSON-serializable value. Deliberately typed `unknown` at the public
 * boundary (rather than a closed recursive JSON-value union) so every
 * caller's own already-zod-validated contract shape (e.g.
 * `AuthorizationEnvelopeContent`, a `ProvisionalPerformanceBudgetEntry[]`, a
 * `Requirement`'s `acceptanceCriteria`) can be passed directly with no manual
 * widening/casting at every call site — a recursive union rejects concrete
 * object types with a fixed property set (no index signature), which every
 * real caller has. Runtime behavior is unaffected: an `undefined`-valued
 * object property is omitted (matching `JSON.stringify`'s own semantics)
 * rather than serialized.
 */
export type CanonicalJsonValue = unknown;

/**
 * Deterministically serializes `value` with every object's keys sorted
 * (recursively). Arrays keep their given order — order is semantically
 * meaningful for this system's own fields, so this function must not
 * silently reorder it.
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
