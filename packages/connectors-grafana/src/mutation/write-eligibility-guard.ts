import { ConnectorError, type CapabilitySnapshot } from "@eo/contracts";

/**
 * roadmap/20-grafana-adapters.md exit criterion: "An unknown/untested
 * build-info fixture forces a read-only `CapabilitySnapshot`; a mutation
 * attempt against that snapshot is asserted to fail before any HTTP call."
 * `CapabilitySnapshot.isReadOnly` is the single source of truth this guard
 * consults — a synchronous, side-effect-free check, so calling it can
 * never itself perform (or delay performing) an HTTP call; the caller
 * (`../adapter.js`'s `planCreate`/`planUpdate`) invokes this BEFORE
 * resolving a route table or building any request.
 *
 * **Known, accepted narrow window (adversarial-review LOW finding,
 * documented rather than "fixed cheap"):** this guard runs only at PLAN
 * time (`planCreate`/`planUpdate`) — `@eo/gateway`'s own
 * `MutationApplyClient.buildRequest(plan)` contract is deliberately
 * synchronous and I/O-free ("Pure — no I/O of its own," that package's own
 * doc comment), so `./mutation-apply-client.ts`'s `buildRequest` has no
 * structurally available point to re-await an async capability-snapshot
 * re-check immediately before issuing the request. A snapshot that flips
 * writable→read-only in the (typically short) window between `planCreate`/
 * `planUpdate` and the later `observability.apply` call is therefore not
 * re-guarded at apply time by this package alone. Mitigating this fully
 * would require either a cross-cutting change to `@eo/gateway`'s own
 * `MutationApplyClient` contract (making `buildRequest` async, or adding an
 * explicit pre-apply snapshot-freshness hook to `executeMutationPlan`
 * itself) — both are 16's own interface to evolve, not this phase's to
 * silently work around. Carried forward to 21/16 in
 * `docs/evidence/phase-20/README.md`.
 */
export function assertWritableCapability(snapshot: CapabilitySnapshot): void {
  if (snapshot.isReadOnly) {
    throw ConnectorError.unsupported({
      message: `Grafana connection ${snapshot.externalConnectionId} is read-only (unrecognized/untested build ${snapshot.product} ${snapshot.edition} ${snapshot.version}) — no mutation is permitted`,
      provider: "grafana",
      retryable: false,
    });
  }
}
