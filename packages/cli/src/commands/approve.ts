/**
 * `approve <digest>` — the terminal half of the escalation path ledger
 * Gap 18 kept the token machinery for. A ChangeSet parked in
 * `awaiting_approval` (its envelope outside the standing policy, or its
 * intake run non-interactively where the prompt correctly declined at EOF)
 * is approved by a human HERE: resolve the digest to the pending ChangeSet,
 * render `runApprovalFlow`'s prompt, and complete verification in-process
 * (`../intake/complete-envelope-approval.ts`) — the token never leaves this
 * process. This is the command the `/eo:approve` skill delegates to.
 *
 * Who may answer lives in `../approval/interactive-terminal.ts` — a TTY check
 * alone was defeated by a pty wrapper in adversarial review, and that module
 * documents precisely what the replacement does and does not prove.
 *
 * What the human is shown is the other half of the gate. A `canonicalHash`
 * identifies envelope CONTENT and deliberately excludes the ChangeSet id, so a
 * bare digest is an opaque hex string the human has no way to evaluate — they
 * would be consenting to whatever a model told them it meant. The prompt
 * therefore renders the authority itself: the ChangeSet, the owned paths, the
 * commands, the network destinations, the credential references.
 */
import type { AuthorizationEnvelope, ChangeSet } from "@crabgic/contracts";
import { EXIT_GENERAL_ERROR, EXIT_OK, EXIT_USAGE_ERROR } from "../exit-codes.js";
import type { ApproveCommand } from "../argv/types.js";
import { ApprovalDeclinedError, runApprovalFlow } from "../approval/prompt.js";
import { resolveApprovalTerminal } from "../approval/interactive-terminal.js";
import { sanitizeForTerminal } from "../output/sanitize.js";
import { completeEnvelopeApproval } from "../intake/complete-envelope-approval.js";
import { formatJson, type CommandResult } from "../output/format.js";
import { notImplementedResult } from "./not-implemented.js";
import type { CliDependencies } from "./types.js";

/**
 * The authority under review, rendered in full above the digest prompt.
 *
 * Every field an `AuthorizationEnvelope` can grant appears, including the ones
 * that are empty — "network destinations: none" is information the human needs,
 * and silence would read the same whether the list was empty or omitted.
 */
function renderEnvelopeForConsent(changeSet: ChangeSet, envelope: AuthorizationEnvelope): string {
  const list = (values: readonly string[]): string =>
    values.length === 0 ? "(none)" : values.map((value) => sanitizeForTerminal(value)).join(", ");
  return [
    "",
    "This approval grants the following authority:",
    "",
    `  change set:            ${sanitizeForTerminal(changeSet.id)}`,
    `  owned paths:           ${list(envelope.ownedPaths)}`,
    `  commands:              ${list(envelope.commands)}`,
    `  network destinations:  ${list(envelope.networkDestinations)}`,
    `  credential references: ${list(envelope.credentialReferences)}`,
    `  prohibited actions:    ${list(envelope.prohibitedActions)}`,
    "",
  ].join("\n");
}

/** The pending ChangeSets whose OWN stored envelope carries this digest — resolved server-side, mirroring `runContractApprove`'s confused-deputy guard. */
function pendingChangeSetsForDigest(
  deps: NonNullable<CliDependencies["intake"]>,
  digest: string,
): readonly ChangeSet[] {
  return deps.changeSets
    .list()
    .filter(
      (changeSet) =>
        changeSet.state === "awaiting_approval" &&
        deps.envelopes.get(changeSet.authorizationEnvelopeId)?.canonicalHash === digest,
    );
}

export async function runApproveCommand(
  cmd: ApproveCommand,
  deps: CliDependencies,
): Promise<CommandResult> {
  const intake = deps.intake;
  if (intake === undefined) {
    return notImplementedResult(cmd.command, cmd.json);
  }

  // Refused BEFORE any registry read, so a caller that may not approve also
  // cannot use this command to learn which digests are pending.
  const terminal =
    intake.resolveTerminal?.() ??
    resolveApprovalTerminal({ env: process.env, isTty: process.stdin.isTTY === true });
  if (!terminal.allowed) {
    return {
      exitCode: EXIT_USAGE_ERROR,
      stderr:
        `\`approve\` refused: ${terminal.reason}\n` +
        `Run \`crabgic approve ${sanitizeForTerminal(cmd.digest)}\` in a terminal you opened yourself.\n`,
    };
  }

  const safeDigest = sanitizeForTerminal(cmd.digest);
  const pending = pendingChangeSetsForDigest(intake, cmd.digest);
  if (pending.length === 0) {
    return {
      exitCode: EXIT_GENERAL_ERROR,
      stderr: `no ChangeSet awaiting approval has an envelope with digest "${safeDigest}"\n`,
    };
  }
  if (pending.length > 1) {
    return {
      exitCode: EXIT_GENERAL_ERROR,
      stderr:
        `ambiguous digest: ${pending.length} ChangeSets awaiting approval share envelope ` +
        `digest "${safeDigest}" (${pending.map((c) => sanitizeForTerminal(c.id)).join(", ")}) — ` +
        "resolve or cancel the duplicates first\n",
    };
  }
  const changeSet = pending[0]!;
  const envelope = intake.envelopes.get(changeSet.authorizationEnvelopeId);
  if (envelope === undefined) {
    // Unreachable via `pendingChangeSetsForDigest` (it matched on this very
    // envelope), but a re-read is a re-read: refuse rather than prompt for an
    // authority this process can no longer describe.
    return {
      exitCode: EXIT_GENERAL_ERROR,
      stderr: `ChangeSet ${sanitizeForTerminal(changeSet.id)}'s authorization envelope is no longer readable — refusing to prompt for authority it cannot render\n`,
    };
  }

  const io = intake.io ?? { input: process.stdin, output: process.stdout };
  let token: string;
  try {
    // The authority first, the digest second: the human is consenting to what
    // this grants, not to a hex string a model handed them.
    io.output.write(renderEnvelopeForConsent(changeSet, envelope));
    const minted = await runApprovalFlow(intake.minter, "envelope_hash", cmd.digest, io);
    token = minted.token;
  } catch (err) {
    if (err instanceof ApprovalDeclinedError) {
      return cmd.json
        ? { exitCode: EXIT_OK, stdout: formatJson({ approved: false, declined: true }) }
        : {
            exitCode: EXIT_OK,
            stdout: `approval declined — ChangeSet ${sanitizeForTerminal(changeSet.id)} remains awaiting_approval\n`,
          };
    }
    throw err;
  }

  const approval = await completeEnvelopeApproval(changeSet, cmd.digest, token, {
    secretKey: intake.secretKey,
    journal: intake.journal,
    changeSets: intake.changeSets,
    envelopes: intake.envelopes,
    intentContracts: intake.intentContracts,
    workUnits: intake.workUnits,
  });

  if (cmd.json) {
    return {
      exitCode: approval.approved ? EXIT_OK : EXIT_GENERAL_ERROR,
      stdout: formatJson(
        approval.approved
          ? { approved: true, changeSetId: approval.changeSet.id, state: approval.changeSet.state }
          : { approved: false, reason: approval.reason },
      ),
    };
  }
  return approval.approved
    ? {
        exitCode: EXIT_OK,
        stdout: `ChangeSet ${sanitizeForTerminal(approval.changeSet.id)} approved — now ${approval.changeSet.state}\n`,
      }
    : {
        exitCode: EXIT_GENERAL_ERROR,
        stderr: `approval failed: ${sanitizeForTerminal(approval.reason)}\n`,
      };
}
