/**
 * `TrustCommandDependencies` — the dependency bag `./trust-review.ts` /
 * `./trust-approve.ts` / `./trust-revoke.ts` take, mirroring 09's own
 * `CliDependencies` convention (`packages/cli/src/commands/types.ts`) so a
 * future coordinated edit to `packages/cli/src/commands/dispatch.ts` (out
 * of this task's file-scope authority — see the phase-12 final report's
 * deviations) can wire these in with minimal friction.
 *
 * **Deviation, documented:** this is a DISTINCT bag from 09's own
 * `CliDependencies`, not a reuse of it — 09's committed `CliDependencies`
 * only exposes `journal: Pick<JournalStore, "queryEntries" | "verifyJournal">`
 * (no `appendEntry`), because at 09's own build time nothing in that
 * package needed to WRITE a journal entry directly (every write went
 * through the supervisor). `trust approve`'s `ApprovalTokenMinter` needs
 * `appendEntry` to journal `approval_token_mint` (mirroring 09's OWN
 * `approval/token.ts`, which takes exactly this same one-method sink
 * shape). The two bags stay structurally compatible: a caller wiring both
 * together needs only to add `store`/`minter`/`approvalLedger` alongside
 * 09's existing fields.
 *
 * **Resolved (2026-07-25):** the original note here said reconciling the
 * two bags was blocked "once this package is allowed to touch
 * `packages/cli` again". That framing is obsolete — the primitives this
 * bag needs (`ApprovalTokenMinter`, and the `CommandResult`/`EXIT_*`
 * vocabulary the three backends return) were relocated to `@crabgic/contracts`,
 * so `@crabgic/detect` no longer depends on the CLI package in either
 * direction. This bag stays distinct from `CliDependencies` on the merits
 * — it names capability-store collaborators that mean nothing to the other
 * commands — not because of a dependency restriction.
 *
 * **Amended 2026-08-01 (interface-ledger Gap 5, resolution):** the note
 * above said this bag "deliberately omits `appendEntry`" because nothing
 * here needed to write a journal entry directly — every write went through
 * the minter. That was exactly the hole Gap 5's resolution closes: a
 * REJECTED capability audit never mints, so it never reached the journal
 * at all, and `trust revoke`'s flip back to `rejected` was likewise
 * unrecorded. The sink is NOT a field on this bag and the backends do not
 * journal themselves: it is threaded into `createCapabilityStore(root, {
 * journal })` by whoever constructs `store` (see
 * `../capability-store/audit-journal.ts`), so a transition is recorded
 * exactly once, at the single place that rewrites the artifact, no matter
 * which caller triggers it — and a store built without one refuses the
 * flip rather than performing it silently.
 */
import type { ApprovalTokenMinter } from "@crabgic/contracts";
import type { ApprovalLedger } from "../capability-store/approval-ledger.js";
import type { CapabilityStore } from "../capability-store/store.js";

export interface TrustCommandDependencies {
  /**
   * Construct this with `createCapabilityStore(root, { journal })` —
   * `trust revoke` flips a decision, and an unjournaled flip is refused
   * (interface-ledger Gap 5).
   */
  readonly store: CapabilityStore;
  /** A fully-configured minter — if durable journaling of `approval_token_mint` is desired, construct it with `ApprovalTokenMinterOptions.journal` already wired (mirroring `@crabgic/contracts`'s `approval/token.ts` convention); this bag does not re-journal on its own. */
  readonly minter: ApprovalTokenMinter;
  readonly approvalLedger: ApprovalLedger;
}
