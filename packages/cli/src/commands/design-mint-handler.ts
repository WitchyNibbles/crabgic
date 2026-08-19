import { designRevisionDigest, formatJson, type CommandResult } from "@crabgic/contracts";
import { EXIT_OK, EXIT_USAGE_ERROR } from "../exit-codes.js";
import { ApprovalDeclinedError, runApprovalFlow } from "../approval/prompt.js";
import type { ApprovalPromptIo } from "../approval/prompt.js";
import type { ApprovalTokenMinter } from "../approval/token.js";
import type { DesignVerdictCommand } from "../argv/types.js";

/**
 * `crabgic design mint` — owner ruling 2026-08-19, amending R2.
 *
 * ⚠️ WHAT R2 SAID, AND WHAT SURVIVES. R2 made `design approve` a CLI command so
 * that "nothing reachable from a session may record this verdict"
 * (`./design-verdict-handler.ts`), on the grounds that a model which can satisfy
 * its own approval gate has no gate. That guarantee is UNCHANGED. What the
 * amendment changes is only what carries the owner's act: a token minted at
 * their own terminal, which the gateway verifies once, instead of a file the
 * command writes directly.
 *
 * ⚠️ BOUGHT FOR THE AUDIT TRAIL, NOT FOR CONVENIENCE — measured before it was
 * built. `./design-verdict-handler.ts` calls `runApprovalFlow` ZERO times, so
 * approving was already one terminal command with no prompt; minting is one
 * terminal command too. Nobody should read this as removing a context switch.
 * What it adds is that the act becomes a journaled `approval_token_mint`,
 * claimed exactly once through the durable ledger — the footing contract and
 * capability approvals already stand on, rather than a bare write to
 * `design-verdicts.json` that leaves no trace of the act itself.
 *
 * THE PROMPT IS THE ACT. `runApprovalFlow` is the only reachable path to
 * `mint`, and it mints solely on an explicit "yes": a declined or ambiguous
 * answer throws rather than producing an unused token. So a token existing at
 * all is evidence a human typed yes to this exact digest.
 */

export interface DesignMintHandlerDeps {
  readonly minter: ApprovalTokenMinter;
  /** Defaults to the real terminal; injected so a test can drive the prompt without one. */
  readonly io?: ApprovalPromptIo;
}

export async function runDesignMintCommand(
  command: DesignVerdictCommand,
  deps: DesignMintHandlerDeps,
): Promise<CommandResult> {
  const io = deps.io ?? { input: process.stdin, output: process.stdout };
  /**
   * ⚠️ THE DIGEST BINDS THE REVISION, so the token cannot survive an edit of the
   * design it approves. That is the same window the gate's own "approved a
   * DIFFERENT design revision" refusal closes — closed here too, at mint time,
   * rather than relying on the redeeming side alone.
   */
  const digest = designRevisionDigest(command.changeSetId, command.revision);

  let minted;
  try {
    minted = await runApprovalFlow(deps.minter, "design_revision", digest, io);
  } catch (error) {
    if (error instanceof ApprovalDeclinedError) {
      const reason = "design approval was declined at the terminal prompt; no token was minted";
      return {
        exitCode: EXIT_USAGE_ERROR,
        stderr: `${reason}\n`,
        ...(command.json ? { stdout: formatJson({ ok: false, error: reason }) } : {}),
      };
    }
    throw error;
  }

  if (command.json) {
    return {
      exitCode: EXIT_OK,
      stdout: formatJson({
        ok: true,
        token: minted.token,
        tokenId: minted.tokenId,
        changeSetId: command.changeSetId,
        designRevision: command.revision,
        expiresAt: minted.expiresAt,
      }),
    };
  }

  const lines = [
    `Design approval token minted for change set ${command.changeSetId}.`,
    `Revision: ${command.revision}`,
    `Expires:  ${minted.expiresAt}`,
    "",
    minted.token,
    "",
    "Hand this to the session so it can record the verdict. It is single-use:",
    "redeeming it twice is refused by the durable approval ledger.",
  ];
  return { exitCode: EXIT_OK, stdout: `${lines.join("\n")}\n` };
}
