/**
 * Redeem an owner-minted `design_revision` token and record the design verdict.
 *
 * ⚠️ OWNER RULING 2026-08-19, AMENDING R2 AND REVERSING A CLOSED FINDING.
 * `docs/security-posture.md` records, under "Closed in code 2026-07-29", that
 * `run` and `approve` "mint, verify and spend the token inside the one process
 * that rendered the prompt, and no result shape or rendered output carries it"
 * — because in a manager session "the only thing standing between those two
 * points is the model, so the shipped design already makes the model the
 * courier for a human-approval token" (`docs/interface-ledger.md`, Gap 18).
 *
 * This module deliberately reinstates that courier for the DESIGN gate only,
 * because the owner ruled the gate must complete inside Claude Code rather than
 * at a terminal. The exposure was put to the owner with the finding named, and
 * reaffirmed. It is recorded here rather than softened: **the model sees a
 * human-approval credential in transit.** What that buys is that the design
 * gate no longer requires dropping to a shell.
 *
 * WHAT SURVIVES THE AMENDMENT, and it is most of the property set:
 *
 * - Minting is still reachable ONLY through `runApprovalFlow`'s terminal
 *   prompt, which mints solely on an explicit yes. A token existing at all is
 *   still evidence a human typed yes to this exact digest.
 * - The expected digest is derived HERE from the change set id and revision,
 *   never accepted from the caller — the same server-side derivation
 *   `build-tool-registry.ts` and `runContractApprove` use. A caller cannot
 *   present a token for revision A and have it recorded against revision B.
 * - Single use is enforced by the durable ledger, across processes and
 *   forever: a replay lands in `ApprovalTokenAlreadyVerifiedError`.
 * - The token is bound to the revision, so it does not survive an edit of the
 *   design it approves.
 *
 * WHAT DOES NOT SURVIVE: the guarantee that no rendered output carries the
 * token. `design mint` prints it, by design, so the owner can hand it over.
 */
import type { OwnerDesignVerdict } from "@crabgic/contracts";
import { designRevisionDigest, OwnerDesignVerdictSchema } from "@crabgic/contracts";
import {
  verifyApprovalTokenDurable,
  type DurableApprovalLedgerOptions,
} from "../approval/durable-approval-ledger.js";
import { recordDesignVerdict } from "./design-verdict-store.js";

export interface RedeemDesignVerdictInput {
  readonly changeSetId: string;
  readonly designRevision: string;
  readonly verdict: OwnerDesignVerdict["verdict"];
  /** Required when rejecting — the schema refuses a rejection that says nothing. */
  readonly reason?: string;
  readonly token: string;
}

export interface RedeemDesignVerdictDeps {
  readonly designVerdictsPath: string;
  readonly stateHome: string;
  readonly ledger: DurableApprovalLedgerOptions;
  /** Injected so the emitted record is deterministic under test. */
  readonly now?: () => Date;
}

/**
 * Verifies first, records second, and never the other way round. If
 * verification throws — bad signature, wrong subject kind, wrong digest,
 * expired, or already spent — nothing is written, so a failed redemption
 * leaves no verdict behind.
 */
export async function redeemDesignVerdict(
  input: RedeemDesignVerdictInput,
  deps: RedeemDesignVerdictDeps,
): Promise<OwnerDesignVerdict> {
  /**
   * The timestamp is taken HERE rather than accepted as an argument, for the
   * reason `../commands/design-verdict-handler.ts` gives: a caller supplying
   * `recordedAt` could backdate a verdict, and the only thing that field is for
   * is telling a later reader when the owner actually answered.
   */
  const now = deps.now ?? (() => new Date());
  const candidate = {
    schemaVersion: 1,
    changeSetId: input.changeSetId,
    designRevision: input.designRevision,
    verdict: input.verdict,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    recordedAt: now().toISOString(),
  };

  /**
   * ⚠️ VALIDATE BEFORE SPENDING. `verifyApprovalTokenDurable` CONSUMES the
   * token — durably, across processes, forever. Verifying first and letting the
   * store reject afterwards would burn a single-use human approval on a
   * malformed request, and the owner would have to walk back to their terminal
   * and mint again for a mistake that was never theirs. A rejection with no
   * `reason` is exactly that case, and the store refuses it by design.
   *
   * So the shape is checked against the same schema the store enforces, before
   * anything irreversible happens.
   */
  const verdict: OwnerDesignVerdict = OwnerDesignVerdictSchema.parse(candidate);

  const digest = designRevisionDigest(input.changeSetId, input.designRevision);
  await verifyApprovalTokenDurable(
    input.token,
    { subjectKind: "design_revision", digest },
    deps.ledger,
  );

  await recordDesignVerdict(deps.designVerdictsPath, verdict, deps.stateHome);
  return verdict;
}
