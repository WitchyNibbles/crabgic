/**
 * Canonical hashing for roadmap/15's budget hash-link check
 * (`./hash-link.ts`, `./journal-anchor.ts`).
 *
 * The implementation moved to `@crabgic/contracts`
 * (`src/shared/canonical-hash.ts`) in roadmap/24, which needed the same
 * primitive for the acceptance-criteria seal. This module's original header
 * recorded that the algorithm was hand-rolled locally as a deliberate
 * byte-identical duplicate of `packages/supervisor/src/intake/canonical-hash.ts`,
 * because `packages/supervisor` (11) is not a dependency of `packages/perf`
 * (15) — correct, and the duplication was the right call at the time. But
 * both packages already depend on `@crabgic/contracts`, so the shared home
 * that removes the duplication existed all along, and it introduces no
 * undeclared cross-phase edge.
 *
 * The byte-identity that mattered — 11 and 15 hashing the same
 * `ProvisionalPerformanceBudgetEntry[]` to the same digest — is now
 * structural rather than maintained by hand. Re-exported rather than
 * re-pathed so no call site changed and this module's own tests still
 * exercise it through this path, which is what proves the move changed no
 * behavior.
 */
export { canonicalHash, canonicalStringify, type CanonicalJsonValue } from "@crabgic/contracts";
