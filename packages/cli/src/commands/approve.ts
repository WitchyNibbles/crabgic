/**
 * `approve <digest>` — the human consent ceremony for a ChangeSet parked in
 * `awaiting_approval`: resolve the digest to the pending ChangeSet, render
 * `runApprovalFlow`'s prompt, and complete verification in-process
 * (`../intake/complete-envelope-approval.ts`) — the token never leaves this
 * process. This is the command the `/eo:approve` skill delegates to.
 *
 * WHAT THIS CAN AND CANNOT DO (corrected 2026-07-30 — the header used to
 * claim this was the remedy for "an envelope outside the standing policy",
 * which review traced to be impossible). The token gates exactly ONE thing:
 * the `awaiting_approval → ready` ChangeSet transition — owner consent to
 * the PLAN (e.g. after a material amendment, or an intake whose prompt
 * declined at EOF). It grants NO authority: the daemon's dispatch gate is
 * containment-only by the ledger's own ruling ("no prompt and no token …
 * there is no third outcome") and reads no token, so an envelope outside the
 * standing policy is refused again at dispatch no matter how many approvals
 * were minted. The remedy for an out-of-policy envelope is editing the
 * standing policy — the refusal names the file — and re-running the intake.
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
import { renderResultLine } from "../output/reports.js";
import { notImplementedResult } from "./not-implemented.js";
import { dispatchReadyChangeSet } from "./real-handlers.js";
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
  // Remote authorizations render reference + flags: review established that
  // zero flags is NOT trivially safe (the flag taxonomy is per-kind, not
  // per-risk), so the reference itself is the load-bearing line.
  const remotes = (values: AuthorizationEnvelope["remoteResourceAuthorizations"]): string =>
    values.length === 0
      ? "(none)"
      : values
          .map(
            (authorization) =>
              `${sanitizeForTerminal(authorization.reference)}${
                authorization.highImpactFlags.length === 0
                  ? ""
                  : ` [${authorization.highImpactFlags.join(", ")}]`
              }`,
          )
          .join(", ");
  return [
    "",
    "This approval grants the following authority:",
    "",
    `  change set:            ${sanitizeForTerminal(changeSet.id)}`,
    `  owned paths:           ${list(envelope.ownedPaths)}`,
    `  commands:              ${list(envelope.commands)}`,
    `  network destinations:  ${list(envelope.networkDestinations)}`,
    `  credential references: ${list(envelope.credentialReferences)}`,
    `  remote resources:      ${remotes(envelope.remoteResourceAuthorizations)}`,
    `  dependencies:          ${list(envelope.dependencies)}`,
    `  temporary services:    ${list(envelope.temporaryServices)}`,
    `  worker turns/attempt:  ${String(envelope.maxTurnsPerAttempt)}`,
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
            stdout: renderResultLine(
              "blocked",
              `approval declined — ChangeSet ${sanitizeForTerminal(changeSet.id)} remains awaiting_approval`,
            ),
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
    requirements: intake.requirements,
    workUnits: intake.workUnits,
  });

  if (!approval.approved) {
    return cmd.json
      ? {
          exitCode: EXIT_GENERAL_ERROR,
          stdout: formatJson({ approved: false, reason: approval.reason }),
        }
      : {
          exitCode: EXIT_GENERAL_ERROR,
          stderr: `approval failed: ${sanitizeForTerminal(approval.reason)}\n`,
        };
  }

  // This command completes an interrupted `run`, so it finishes the job: the
  // human just authorized the work, and making them run a second command to
  // actually start it is the friction Gap 18's direction exists to remove.
  const dispatch = await dispatchReadyChangeSet(approval.changeSet.id, deps);
  if (cmd.json) {
    return {
      exitCode: dispatch.accepted ? EXIT_OK : EXIT_GENERAL_ERROR,
      stdout: formatJson({
        approved: true,
        changeSetId: approval.changeSet.id,
        state: approval.changeSet.state,
        dispatch,
      }),
    };
  }
  const safeId = sanitizeForTerminal(approval.changeSet.id);
  return dispatch.accepted
    ? {
        exitCode: EXIT_OK,
        stdout: renderResultLine(
          "ok",
          `ChangeSet ${safeId} approved and dispatched as run ${sanitizeForTerminal(dispatch.runId ?? "(unknown)")}`,
        ),
      }
    : {
        // Approved and durably `ready`; only the start failed. Said plainly:
        // approval records consent to the PLAN and cannot grant authority —
        // if the refusal below is a containment refusal, no re-approval will
        // ever change it, only a policy edit will.
        exitCode: EXIT_GENERAL_ERROR,
        stderr:
          `ChangeSet ${safeId} is approved and ready, but dispatch was refused: ` +
          `${sanitizeForTerminal(dispatch.reason ?? "no reason given")}\n` +
          `Approval records consent to the plan; it cannot grant authority beyond the ` +
          `standing policy. If the refusal names an escaping dimension, edit the standing ` +
          `policy it names, then run \`crabgic run\` again.\n`,
      };
}
