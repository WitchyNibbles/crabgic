/**
 * `capability.approve` tool handler — roadmap/12 §Interfaces produced:
 * "`capability.approve` only **verifies** a previously human-minted
 * `trust approve` token; it is never model-satisfiable, mirroring
 * `contract.approve`'s treatment in 11." Reuses 09's own
 * `ApprovalTokenMinter` (`engineering-orchestrator`) verbatim — the same
 * primitive minting/verifying 11's envelope-hash tokens, distinguished by
 * `subjectKind: "capability_digest"` so a token minted for one subject
 * kind can never verify against the other (09's own guarantee).
 *
 * Fails CLOSED for every distinct failure mode (roadmap/12's own named
 * seeded threat: "model-self-approval fixture against `capability.approve`
 * (must fail closed with no pre-minted token)") — a missing/invalid/
 * expired/already-consumed token NEVER flips the stored decision to
 * `approved`; only a successful `minter.verify(...)` call does.
 */
import type { ApprovalTokenMinter } from "engineering-orchestrator";
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

export function runCapabilityApprove(
  input: CapabilityApproveInput,
  deps: CapabilityApproveDeps,
): CapabilityApproveResult {
  try {
    deps.minter.verify(input.token, { subjectKind: "capability_digest", digest: input.digest });
  } catch (err) {
    return {
      approved: false,
      reason: err instanceof Error ? err.message : "token verification failed",
    };
  }

  deps.store.updateDecision(deps.storeKey, "approved");
  return { approved: true };
}
