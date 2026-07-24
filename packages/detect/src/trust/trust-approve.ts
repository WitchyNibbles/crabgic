/**
 * `trust approve <digest>` backend — roadmap/12 §Interfaces produced:
 * "`trust approve` mints a one-time approval token bound to the
 * capability's content digest ... and journals it as an
 * `approval_token_mint` entry." Minting only — this command NEVER itself
 * flips a stored decision to `approved`; only `capability.approve`
 * (`../mcp/capability-approve-handler.ts`), verifying the token this
 * command mints, does that (roadmap/12: "`capability.approve` only
 * verifies... it is never model-satisfiable").
 */
import {
  EXIT_OK,
  formatJson,
  type CommandResult,
  type TrustApproveCommand,
} from "engineering-orchestrator";
import type { TrustCommandDependencies } from "./dependencies.js";

export async function runTrustApproveCommand(
  cmd: TrustApproveCommand,
  deps: TrustCommandDependencies,
): Promise<CommandResult> {
  const minted = await deps.minter.mint("capability_digest", cmd.digest);
  deps.approvalLedger.record(minted.tokenId, cmd.digest);

  return {
    exitCode: EXIT_OK,
    stdout: cmd.json
      ? formatJson(minted)
      : `minted approval token ${minted.tokenId} for digest ${cmd.digest} (expires ${minted.expiresAt})\n`,
  };
}
