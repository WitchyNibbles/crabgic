/**
 * `checkReauditRequired` — roadmap/12 exit criterion: "Approved capability
 * is digest-pinned in the manifest under `capability-store/`; a changed
 * digest or permission footprint forces re-audit." Compares a freshly
 * computed `(digest, permissionFootprint)` pair against the latest stored
 * entry for the same capability name — reuses `./key.ts`'s own pure key
 * function rather than re-deriving a second notion of "changed."
 */
import { computeCapabilityStoreKey } from "./key.js";
import type { CapabilityStore } from "./store.js";

export interface ReauditDecision {
  readonly requiresReaudit: boolean;
  readonly reason: string;
}

export function checkReauditRequired(
  store: Pick<CapabilityStore, "findLatestByName">,
  name: string,
  freshDigest: string,
  freshPermissionFootprint: readonly string[],
): ReauditDecision {
  const latest = store.findLatestByName(name);
  if (latest === undefined) {
    return { requiresReaudit: true, reason: "no prior audit found for this capability name" };
  }

  const freshKey = computeCapabilityStoreKey(freshDigest, freshPermissionFootprint);
  if (freshKey === latest.key) {
    return {
      requiresReaudit: false,
      reason: "digest and permission footprint unchanged since the last audit",
    };
  }

  if (latest.report.digest !== freshDigest) {
    return { requiresReaudit: true, reason: "digest changed since the last audit" };
  }
  return { requiresReaudit: true, reason: "permission footprint changed since the last audit" };
}
