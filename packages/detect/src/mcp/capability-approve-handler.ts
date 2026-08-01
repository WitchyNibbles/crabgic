/**
 * `capability.approve` tool handler — roadmap/12 §Interfaces produced:
 * "`capability.approve` only **verifies** a previously human-minted
 * `trust approve` token; it is never model-satisfiable, mirroring
 * `contract.approve`'s treatment in 11." Reuses 09's own
 * `ApprovalTokenMinter` (`@crabgic/contracts`) verbatim — the same
 * primitive minting/verifying 11's envelope-hash tokens, distinguished by
 * `subjectKind: "capability_digest"` so a token minted for one subject
 * kind can never verify against the other (09's own guarantee).
 *
 * Fails CLOSED for every distinct failure mode (roadmap/12's own named
 * seeded threat: "model-self-approval fixture against `capability.approve`
 * (must fail closed with no pre-minted token)") — a missing/invalid/
 * expired/already-consumed token NEVER flips the stored decision to
 * `approved`; only a successful `minter.verify(...)` call does.
 *
 * **interface-ledger Gap 5, resolution (2026-08-01):** the flip itself is
 * now journaled. `store.updateDecision` is journal-first and rejects if
 * the append fails, so a `pending -> approved` transition that cannot be
 * recorded does not happen — the token is consumed by `verify` either way
 * (single-use, by design), but the capability stays unapproved. That is
 * the fail-closed direction: a consumed token with no approval is
 * recoverable by minting another; an approval with no record is not.
 *
 * A journal failure THROWS rather than returning `{approved: false,
 * reason}`, and that asymmetry is deliberate. `approved: false` means "this
 * token does not authorise this capability" — an answer about the
 * REQUEST, which a caller may reasonably surface to a model or a user and
 * move on from. A failed append means "this system could not record what
 * it was about to do" — an answer about the SYSTEM, and collapsing the two
 * would let a caller read an infrastructure fault as a rejected token and
 * retry into the same silent hole. The result union stays a verdict about
 * the token; everything else propagates.
 */
import type { ApprovalTokenMinter } from "@crabgic/contracts";
import type { CapabilityStore } from "../capability-store/store.js";

export interface CapabilityApproveInput {
  readonly digest: string;
  readonly token: string;
}

export interface CapabilityApproveDeps {
  readonly minter: Pick<ApprovalTokenMinter, "verify">;
  readonly store: CapabilityStore;
  /** The store key to flip to `approved` on a successful verify — the caller (11/the gateway) is expected to already know which stored entry this digest+permission-footprint combination resolves to. */
  readonly storeKey: string;
}

export type CapabilityApproveResult =
  { readonly approved: true } | { readonly approved: false; readonly reason: string };

export async function runCapabilityApprove(
  input: CapabilityApproveInput,
  deps: CapabilityApproveDeps,
): Promise<CapabilityApproveResult> {
  try {
    deps.minter.verify(input.token, { subjectKind: "capability_digest", digest: input.digest });
  } catch (err) {
    return {
      approved: false,
      reason: err instanceof Error ? err.message : "token verification failed",
    };
  }

  await deps.store.updateDecision(deps.storeKey, "approved");
  return { approved: true };
}
