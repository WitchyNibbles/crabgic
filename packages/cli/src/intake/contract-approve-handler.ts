/**
 * `contract.approve` tool handler — roadmap/11-intake-contract-approval.md
 * §Interfaces produced item 1: "verify-only — checks a supervisor-minted
 * token, never mints one." §Work item 4's failing-first framing: "a
 * scripted worker-context call to
 * `mcp__${GATEWAY_MCP_SERVER_NAME}__contract.approve`" (`GATEWAY_MCP_SERVER_NAME`,
 * `@eo/contracts` — this comment deliberately uses the template placeholder
 * rather than the resolved literal, matching `../../supervisor/src/intake/
 * project-inspect.ts`'s identical convention) "with no token fails closed."
 * §Exit criteria: "Unmapped requirement blocks the `ready` transition."
 *
 * CRITICAL C1 repair (adversarial-validation finding): the original shape
 * took `changeSetId`, `digest`, and `token` as three INDEPENDENT
 * caller-supplied inputs, verified the token against the caller's own
 * `digest`, and then transitioned the caller's own `changeSetId` — never
 * confirming the two actually belong together. A valid single-use token
 * legitimately minted for ChangeSet A's envelope could therefore flip a
 * DIFFERENT ChangeSet B to `ready` by calling
 * `contract.approve({ changeSetId: B, digest: <A's digest>, token: <A's token> })`
 * — a classic confused-deputy: B's OWN (possibly higher-authority)
 * envelope was never human-approved. FIX: the EXPECTED digest is now
 * derived SERVER-SIDE from `changeSets.get(changeSetId)`'s
 * `authorizationEnvelopeId` -> `envelopes.get(...)`'s `canonicalHash` — the
 * caller-supplied `digest` is cross-checked against it (a mismatch fails
 * closed, `ExpectedDigestMismatchError`, BEFORE the token is ever touched)
 * and the token is verified against the SERVER-DERIVED digest, never the
 * caller-supplied one. Neither a wrong `changeSetId`/`digest` pairing nor a
 * tampered/stale envelope can ever satisfy this gate.
 *
 * LOW L5 repair: pre-checks (digest cross-check, requirement coverage,
 * ready-transition legality) all run BEFORE the single-use token is
 * consumed — a token is only ever burned once every other precondition is
 * already known to hold, so a caller can safely retry with the SAME token
 * after fixing e.g. an incomplete DAG or a not-yet-`awaiting_approval`
 * ChangeSet. `transitionChangeSetToReady` is still called (and could, in a
 * genuine race, still fail after the token is spent) — that residual
 * window is documented, not eliminated; its failure reason explicitly says
 * the token was already consumed.
 */
import {
  findUnmappedRequirements,
  transitionChangeSetToReady,
  type Registry,
  type TransitionChangeSetToReadyOptions,
} from "@eo/supervisor";
import {
  runLifecycleTransition,
  IllegalTransitionError,
  type AuthorizationEnvelope,
  type ChangeSet,
} from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
import { verifyApprovalTokenDurable } from "../approval/durable-approval-ledger.js";

export interface ContractApproveToolInput {
  readonly changeSetId: string;
  readonly digest: string;
  readonly token: string;
}

export interface ContractApproveDeps {
  readonly secretKey: Buffer;
  readonly journal: JournalStore;
  readonly clock?: () => number;
  readonly changeSets: TransitionChangeSetToReadyOptions["changeSets"];
  /** CRITICAL C1: read-only lookup for the ChangeSet's OWN, actual envelope — never trusts the caller's `digest` as the source of truth. */
  readonly envelopes: Pick<Registry<AuthorizationEnvelope>, "get">;
  readonly requirementIds: readonly string[];
  readonly workUnits: TransitionChangeSetToReadyOptions["workUnits"];
}

export type ContractApproveResult =
  | { readonly approved: true; readonly changeSet: ChangeSet }
  | { readonly approved: false; readonly reason: string };

export class ExpectedDigestMismatchError extends Error {
  constructor(changeSetId: string) {
    super(
      `intake: the supplied digest does not match ChangeSet "${changeSetId}"'s own current envelope hash — refusing (confused-deputy guard)`,
    );
    this.name = "ExpectedDigestMismatchError";
  }
}

export async function runContractApprove(
  input: ContractApproveToolInput,
  deps: ContractApproveDeps,
): Promise<ContractApproveResult> {
  const changeSet = deps.changeSets.get(input.changeSetId);
  if (changeSet === undefined) {
    return { approved: false, reason: `unknown ChangeSet "${input.changeSetId}"` };
  }

  // CRITICAL C1: the expected digest is ALWAYS derived from the target
  // ChangeSet's own, actual, currently-stored envelope — never from the
  // caller's own `digest` field, which is cross-checked against it (not
  // trusted) purely so a legitimate caller gets an early, clear rejection
  // reason rather than a bare token-mismatch error.
  const envelope = deps.envelopes.get(changeSet.authorizationEnvelopeId);
  const expectedDigest = envelope?.canonicalHash;
  if (expectedDigest === undefined || input.digest !== expectedDigest) {
    return { approved: false, reason: new ExpectedDigestMismatchError(input.changeSetId).message };
  }

  // L5: pre-check readiness BEFORE consuming the single-use token, so a
  // caller can safely retry with the same token once these are fixed.
  const unmapped = findUnmappedRequirements(deps.requirementIds, deps.workUnits);
  if (unmapped.length > 0) {
    return {
      approved: false,
      reason: `intake: cannot transition to ready — ${unmapped.length} requirement(s) have no owning WorkUnit: ${unmapped.join(", ")}`,
    };
  }
  try {
    runLifecycleTransition(changeSet.state, "ready");
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return { approved: false, reason: err.message };
    }
    throw err;
  }

  try {
    await verifyApprovalTokenDurable(
      input.token,
      { subjectKind: "envelope_hash", digest: expectedDigest },
      {
        secretKey: deps.secretKey,
        journal: deps.journal,
        ...(deps.clock !== undefined ? { clock: deps.clock } : {}),
      },
    );
  } catch (err) {
    return {
      approved: false,
      reason: err instanceof Error ? err.message : "token verification failed",
    };
  }

  try {
    const readyChangeSet = await transitionChangeSetToReady({
      journal: deps.journal,
      changeSets: deps.changeSets,
      changeSetId: input.changeSetId,
      requirementIds: deps.requirementIds,
      workUnits: deps.workUnits,
    });
    return { approved: true, changeSet: readyChangeSet };
  } catch (err) {
    // Genuinely rare race: everything was validated above, the token is
    // now consumed, and the transition STILL failed (e.g. concurrent state
    // change between the pre-check and this call) — the token cannot be
    // un-spent, so this says so explicitly rather than implying a retry
    // with the same token would help.
    const detail = err instanceof Error ? err.message : "ready transition refused";
    return {
      approved: false,
      reason: `token was consumed but the ready transition failed: ${detail}`,
    };
  }
}
