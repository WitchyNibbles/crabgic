/**
 * Canonical hashing — hand-rolled locally rather than imported, because
 * `packages/supervisor` (11) is NOT a dependency of `packages/perf` (15)
 * per the roadmap dependency graph (`roadmap/README.md`'s Mermaid graph has
 * no `P11 -> P15` edge; 15 depends on 13/14 only) — importing it would add
 * an undeclared cross-phase dependency edge. This is the IDENTICAL
 * algorithm `packages/supervisor/src/intake/canonical-hash.ts` implements
 * (sorted-keys JSON serialization + `sha256:`-prefixed hex digest),
 * duplicated deliberately so the two phases' hashes of the same
 * `ProvisionalPerformanceBudgetEntry[]` value are byte-identical — required
 * for roadmap/15's own hash-link check (`./hash-link.ts`) to ever match
 * anything 11 computed. Mirrors the precedent
 * `packages/gates/src/test-support/minimal-compiled-profile.ts`'s own doc
 * comment sets for duplicating rather than importing across a package
 * boundary with no dependency edge.
 */
import { createHash } from "node:crypto";

export type CanonicalJsonValue = unknown;

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

/** SHA-256 hex digest of `canonicalStringify(value)`, prefixed `sha256:` — matches this repo's own digest-string convention (`packages/supervisor/src/intake/canonical-hash.ts`, `packages/detect`'s `computeCandidateDigest`). */
export function canonicalHash(value: CanonicalJsonValue): string {
  const digest = createHash("sha256").update(canonicalStringify(value)).digest("hex");
  return `sha256:${digest}`;
}
