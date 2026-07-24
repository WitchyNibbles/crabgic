/**
 * `computeCapabilityStoreKey` — roadmap/12 §Test plan, "Property" bullet:
 * "capability-store key is a pure function of (digest, permission
 * footprint) — fast-check over random digest/permission mutations proves
 * any change forces a different key." Order-independent over
 * `permissionFootprint` (a re-serialized manifest listing the same
 * permissions in a different order must still resolve to the SAME store
 * entry) but sensitive to any actual difference in either input.
 */
import { createHash } from "node:crypto";

export function computeCapabilityStoreKey(
  digest: string,
  permissionFootprint: readonly string[],
): string {
  const sortedFootprint = [...permissionFootprint].sort();
  const canonical = JSON.stringify({ digest, permissionFootprint: sortedFootprint });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
