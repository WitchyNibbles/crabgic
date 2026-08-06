import type { DispatchAttemptOptions } from "@crabgic/scheduler";

/**
 * The criteria seal these orchestration-matrix scenarios dispatch under.
 *
 * `criteriaSeal` became a REQUIRED member of `DispatchAttemptOptions` when
 * the daemon's requirements registry was wired at the composition root. That
 * change deliberately made the field non-optional so omitting it could not
 * compile — the previous optional form was how the shipped daemon came to
 * resolve an empty requirement set while a full set of green harness suites
 * coexisted with a completely inert production path.
 *
 * The nine suites in this project were missed by that sweep, so
 * `npm run check:e2e-types` has been red on `main`: 25 TS2345 errors, all of
 * them this one member. Because the script `&&`-chains eight independent
 * typecheck projects and this is the fourth, it short-circuits before the
 * remaining projects are reached, and `release-e2e.yml` would fail on it.
 *
 * These scenarios are the honest `requirements: []` case, and it is worth
 * saying WHY rather than only that:
 *
 * - They construct a `TaskPacket` directly. None of them runs intake, so
 *   there are no persisted `Requirement` records for a seal to cover, and
 *   claiming otherwise would be the false-seal shape phase 24 exists to
 *   prevent.
 * - `approvalSeal: undefined` is the unapproved case, distinguished from an
 *   approved-with-no-requirements one. These scenarios exercise dispatch,
 *   crash recovery and resume — never acceptance — so no approval has been
 *   granted and none should be implied.
 *
 * A scenario that ever DOES need a sealed requirement must build its own
 * seal rather than widen this one, so that the distinction stays visible at
 * the call site.
 */
export const UNSEALED_CRITERIA_SEAL: DispatchAttemptOptions["criteriaSeal"] = Object.freeze({
  requirements: [],
  approvalSeal: undefined,
});
