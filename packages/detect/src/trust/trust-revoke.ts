/**
 * `trust revoke <token-id>` backend — roadmap/12 §Interfaces produced:
 * "CLI `trust review|approve|revoke`." Resolves the digest a previously
 * minted token was bound to (`../capability-store/approval-ledger.ts`,
 * since `ApprovalTokenMinter` itself forgets a consumed/expired token by
 * design), finds the corresponding capability-store entry, and flips its
 * decision back to `rejected` — never silently deletes the audit trail.
 *
 * **interface-ledger Gap 5, resolution (2026-08-01):** the flip goes
 * through `store.updateDecision`, which is now journal-first — the
 * `approved -> rejected` transition is appended to the hash-chained
 * journal before `report.json` is rewritten, and a failed append aborts
 * the revoke. This backend is async purely because of that.
 */
import {
  EXIT_GENERAL_ERROR,
  EXIT_OK,
  formatJson,
  renderResultLine,
  type CommandResult,
  type TrustRevokeCommand,
} from "@crabgic/contracts";
import type { TrustCommandDependencies } from "./dependencies.js";

export async function runTrustRevokeCommand(
  cmd: TrustRevokeCommand,
  deps: TrustCommandDependencies,
): Promise<CommandResult> {
  const digest = deps.approvalLedger.lookup(cmd.tokenId);
  if (digest === undefined) {
    const message = `no approval record found for token "${cmd.tokenId}" — nothing to revoke`;
    return {
      exitCode: EXIT_GENERAL_ERROR,
      ...(cmd.json
        ? { stdout: formatJson({ revoked: false, reason: message }) }
        : { stderr: `${message}\n` }),
    };
  }

  const entry = deps.store.findByDigest(digest);
  if (entry === undefined) {
    const message = `token "${cmd.tokenId}" resolved to digest "${digest}", but no capability-store entry exists for it`;
    return {
      exitCode: EXIT_GENERAL_ERROR,
      ...(cmd.json
        ? { stdout: formatJson({ revoked: false, reason: message }) }
        : { stderr: `${message}\n` }),
    };
  }

  await deps.store.updateDecision(entry.key, "rejected");
  return {
    exitCode: EXIT_OK,
    stdout: cmd.json
      ? formatJson({ revoked: true, digest })
      : renderResultLine("ok", `revoked approval for "${entry.report.candidateName}" (${digest})`),
  };
}
