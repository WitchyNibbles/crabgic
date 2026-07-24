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
 * `approval/token.ts`, which takes exactly this same `Pick<JournalStore,
 * "appendEntry">` shape) — widening `CliDependencies` itself is a
 * `packages/cli` edit this task is barred from making unilaterally. The
 * two bags are structurally compatible (a caller wiring both together
 * needs only to add `store`/`minter`/`approvalLedger` alongside 09's
 * existing fields), so reconciling them is a small, low-risk follow-up
 * once this package is allowed to touch `packages/cli` again.
 */
import type { ApprovalTokenMinter } from "engineering-orchestrator";
import type { ApprovalLedger } from "../capability-store/approval-ledger.js";
import type { CapabilityStore } from "../capability-store/store.js";

export interface TrustCommandDependencies {
  readonly store: CapabilityStore;
  /** A fully-configured minter — if durable journaling of `approval_token_mint` is desired, construct it with `ApprovalTokenMinterOptions.journal` already wired (mirroring `packages/cli/src/approval/token.ts`'s own convention); this bag does not re-journal on its own. */
  readonly minter: ApprovalTokenMinter;
  readonly approvalLedger: ApprovalLedger;
}
