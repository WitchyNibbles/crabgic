import type { GateFireResult, GateRegistry } from "./registry.js";
import type { GateContext } from "./types.js";

/**
 * Final-candidate orchestration — roadmap/14 work item 6: "re-fire the FULL
 * registered gate set (own + external registrants) against the exact
 * integrated object ID (08), dispatched as its own `TaskPacket` through
 * 13's executor." This function IS the re-verification primitive: it fires
 * `registry.fireAll` (never a subset, never `fireByTag` for a single tag)
 * against `context.objectId` — which the CALLER must have already resolved
 * to the truly-integrated candidate object id (08's own frozen output),
 * never a cached per-work-unit value.
 *
 * "Final-candidate re-verification never trusts a cached per-work-unit
 * result" (roadmap/14 §Critical correctness points) is enforced by
 * CONSTRUCTION here: this function does not read, does not accept, and has
 * no parameter for any PRIOR `GateFireResult` — the only way to get a
 * result out of it is to actually fire every gate again, right now,
 * against `context.objectId`. There is no shortcut code path that could
 * even attempt to reuse an earlier verdict.
 *
 * The TaskPacket-dispatch half of this work item ("dispatched as its own
 * `TaskPacket` through 13's executor") is proven in
 * `./final-candidate.e2e.test.ts` via `@eo/scheduler`'s real
 * `dispatchAttempt` against a `FakeEngineAdapter` — this module itself has
 * no dependency on `@eo/scheduler`'s dispatch machinery (that would invert
 * the dependency direction the roadmap's own dependency graph establishes,
 * 13 → 14, not 14 → 13's executor internals); it is the pure verification
 * primitive whatever wraps it as a `TaskPacket`'s "work" invokes.
 *
 * FAIL-CLOSED ON AN EMPTY/MIS-WIRED REGISTRY (MINOR-1, adversarial-
 * validation round): `registry.fireAll` is called WITH
 * `requireAtLeastOne: true`. Without this, zero registered gates yields
 * `[]`, and `allGatesPassed([])` is vacuously `true`
 * (`[].every(...) === true`) — the final integrated candidate would
 * "pass" having verified NOTHING. A genuinely empty/mis-wired registry now
 * throws `NoGatesRegisteredError` instead, consistent with this whole
 * phase's fail-closed posture (missing green engine-live record, digest
 * mismatch, missing red baseline — none of those fail open either).
 */
export async function fireFinalCandidateVerification(
  registry: GateRegistry,
  context: GateContext,
): Promise<readonly GateFireResult[]> {
  if (context.stage !== "final_verifying") {
    throw new RangeError(
      `fireFinalCandidateVerification must be called with stage: "final_verifying", got "${context.stage}"`,
    );
  }
  return registry.fireAll(context, { requireAtLeastOne: true });
}

/** `true` iff EVERY fired gate's verdict passed — final-candidate re-verification's own overall pass condition. */
export function allGatesPassed(results: readonly GateFireResult[]): boolean {
  return results.every((r) => r.verdict.passed);
}
