/**
 * Canonical hashing — roadmap/11-intake-contract-approval.md §In scope,
 * "AuthorizationEnvelope" bullet: "canonical hash-stable form"; §Test plan,
 * Unit: "canonical-hash stability and perturbation-sensitivity of
 * `AuthorizationEnvelope`". Used by every 11 builder (`envelope-builder.ts`,
 * `capability-manifest-builder.ts`, the provisional `PerformanceContract`
 * budget hash).
 *
 * The implementation moved to `@crabgic/contracts`
 * (`src/shared/canonical-hash.ts`) in roadmap/24, which needed the same
 * primitive for the acceptance-criteria seal. This module's original header
 * recorded that its byte-identical twin in `packages/perf` was deliberate
 * "because there is no P11 → P15 dependency edge" — correct, but both
 * packages already depend on `@crabgic/contracts`, so the edge that removes
 * the duplication was there all along. Re-exported rather than re-pathed so
 * no call site changed and this module's own tests still exercise it
 * through this path — which is what proves the move changed no behavior.
 */
export { canonicalHash, canonicalStringify, type CanonicalJsonValue } from "@crabgic/contracts";
