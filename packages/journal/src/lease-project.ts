/**
 * `acquireProjectLease` — VALIDATION ROUND (2026-07-18) fix, exit-criteria
 * validator finding (accepted-MINOR): roadmap/04-journal-idempotency-
 * leases.md §Interfaces produced names `Lease.acquire(projectHash)`, but
 * `Lease.acquire`'s real, primary, directly-testable signature is
 * `(leaseDir, projectHash, opts)` — `leaseDir` is an explicit constructor
 * argument this module (like `lease.ts` itself — see its own file-level
 * class doc comment) deliberately does not own resolution of.
 *
 * This convenience wrapper closes that documentation gap: it resolves
 * `leaseDir` via `./layout/xdg-layout.js`'s `resolveLeasesDir` +
 * `readXdgEnvFromProcess` (the sole-definition-site XDG layout this
 * package owns) and delegates to the explicit-dir form, matching the
 * roadmap's one-argument convenience shape while keeping
 * `Lease.acquire(leaseDir, projectHash, opts)` as the primary, explicit,
 * unit-testable API (unchanged — this wrapper adds a surface, it does not
 * replace one).
 */

import { readXdgEnvFromProcess, resolveLeasesDir } from "./layout/xdg-layout.js";
import { Lease, type LeaseAcquireOptions } from "./lease.js";

/**
 * `Lease.acquire(projectHash)` — the roadmap's own named convenience shape.
 * Resolves the leases directory from the live process's real XDG
 * environment (`$XDG_STATE_HOME`/`HOME`) and delegates to
 * `Lease.acquire(leaseDir, projectHash, opts)`.
 */
export async function acquireProjectLease(
  projectHash: string,
  opts: LeaseAcquireOptions = {},
): Promise<Lease> {
  const leaseDir = resolveLeasesDir(readXdgEnvFromProcess(), projectHash);
  return Lease.acquire(leaseDir, projectHash, opts);
}
