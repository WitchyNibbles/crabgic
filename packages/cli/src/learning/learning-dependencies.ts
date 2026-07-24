import type { JournalStore } from "@eo/journal";
import type { ChangeSetReferences, ProposalRegistry } from "@eo/learning";
import type { ApprovalTokenMinter } from "../approval/token.js";
import type { ApprovalPromptIo } from "../approval/prompt.js";

/**
 * roadmap/22-learning-system.md's `learn list|approve|reject|rollback`
 * backend — kept OPTIONAL for the identical reason `intake`/`installer`
 * are on `CliDependencies` (`../commands/types.ts`'s own doc comment):
 * every pre-existing roadmap/09 test builds a `CliDependencies` without it
 * and must keep observing the exact same typed `NOT_IMPLEMENTED` shape for
 * `learn-*` unchanged; `../bootstrap.ts`'s real wiring supplies it.
 *
 * `minter`/`secretKey`/`journal` are the SAME 11-owned approval-token
 * mechanism `../intake/contract-approve-handler.ts` already reuses — this
 * is deliberately not a second, parallel implementation. `learn approve`
 * mints/verifies its own tokens under the THIRD, distinct
 * `"learning_review"` subject kind (`../approval/token.ts`), never
 * `"envelope_hash"`/`"capability_digest"`.
 */
export interface LearningDependencies {
  readonly registry: ProposalRegistry;
  /** The FULL store (append-capable) — required by `verifyApprovalTokenDurable`'s durable, cross-process single-use ledger. */
  readonly journal: JournalStore;
  readonly minter: ApprovalTokenMinter;
  readonly secretKey: Buffer;
  readonly changeSetRefs: ChangeSetReferences;
  readonly clock?: () => number;
  /** Defaults to `process.stdin`/`process.stdout` when omitted — injectable so tests never block on real stdio (mirrors `IntakeDependencies.io`). */
  readonly io?: ApprovalPromptIo;
}
