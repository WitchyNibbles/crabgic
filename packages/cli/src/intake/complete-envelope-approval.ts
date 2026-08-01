/**
 * In-process completion of an envelope approval: after the terminal prompt
 * confirmed (and `runApprovalFlow` minted), verify the token and advance the
 * ChangeSet `awaiting_approval → ready` — inside the ONE process that
 * rendered the prompt.
 *
 * WHY IN-PROCESS (2026-07-29). Ledger Gap 18's live audit recorded the flaw
 * in relaying the token instead: `run --json` printed the minted token to
 * stdout for `contract.approve` to consume in another process, and in a
 * manager session "the only thing standing between those two points is the
 * model — so the shipped design already makes the model the courier for a
 * human-approval token". Completing verification here removes the relay:
 * no token is ever rendered anywhere. Every property phase 11's security
 * section names is preserved — minting is still reachable only through the
 * terminal prompt, the expected digest is still derived server-side from the
 * ChangeSet's own stored envelope (`runContractApprove`'s C1 guard), and
 * single-use is still enforced by the durable ledger. The MCP
 * `contract.approve` tool remains, unchanged, for genuinely cross-process
 * escalation flows.
 *
 * The requirement set is resolved from the ChangeSet's own IntentContract —
 * never accepted from a caller — mirroring `../gateway-mcp/
 * build-tool-registry.ts`'s identical server-side derivation.
 */
import type {
  AuthorizationEnvelope,
  ChangeSet,
  IntentContract,
  Requirement,
  WorkUnit,
} from "@crabgic/contracts";
import type { JournalStore } from "@crabgic/journal";
import { resolveRequirements, type Registry } from "@crabgic/supervisor";
import { runContractApprove, type ContractApproveResult } from "./contract-approve-handler.js";

export interface CompleteEnvelopeApprovalDeps {
  readonly secretKey: Buffer;
  readonly journal: JournalStore;
  readonly changeSets: Registry<ChangeSet>;
  readonly envelopes: Registry<AuthorizationEnvelope>;
  readonly intentContracts: Registry<IntentContract>;
  /** Durable `Requirement` store (roadmap/24) — the records the ready transition seals. */
  readonly requirements: Registry<Requirement>;
  readonly workUnits: Registry<WorkUnit>;
}

export async function completeEnvelopeApproval(
  changeSet: ChangeSet,
  digest: string,
  token: string,
  deps: CompleteEnvelopeApprovalDeps,
): Promise<ContractApproveResult> {
  const contract = deps.intentContracts.get(changeSet.intentContractId);
  if (contract === undefined) {
    return {
      approved: false,
      reason: `ChangeSet "${changeSet.id}" has no resolvable IntentContract — refusing to approve without its declared requirements`,
    };
  }
  return runContractApprove(
    { changeSetId: changeSet.id, digest, token },
    {
      secretKey: deps.secretKey,
      journal: deps.journal,
      changeSets: deps.changeSets,
      envelopes: deps.envelopes,
      workUnits: deps.workUnits.list(),
      requirementIds: contract.requirementIds,
      requirements: resolveRequirements(deps.requirements, contract.requirementIds),
    },
  );
}
