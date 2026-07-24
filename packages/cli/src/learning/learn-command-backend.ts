/**
 * `learn list|approve|reject|rollback` backend — roadmap/22-learning-
 * system.md work item 5: "Review/promotion CLI backends ... +
 * independent-review token (11's mechanism, second distinct token)."
 * Replaces roadmap/09's typed `NOT_IMPLEMENTED` stub for these four verbs
 * (`../commands/dispatch.ts`'s own `learn-*` branch, wired only when
 * `deps.learning` is supplied — mirrors `intake`/`installer`'s identical
 * optionality pattern).
 *
 * This is the ONLY place in `packages/cli` that calls `@eo/learning`'s
 * `promoteProposal`/`rollbackProposal`/`ProposalRegistry.transition` — no
 * MCP tool anywhere calls them (interface-ledger Gap 1; verified by
 * `@eo/learning`'s own `red-team/no-mcp-tool-family.redteam.test.ts`), so
 * this backend, reached only via the real CLI argv path, is the sole
 * promotion/review surface, exactly as roadmap/22 requires.
 */
import { createHash } from "node:crypto";
import type { LearningProposal } from "@eo/contracts";
import type {
  LearnApproveCommand,
  LearnListCommand,
  LearnRejectCommand,
  LearnRollbackCommand,
} from "../argv/types.js";
import { EXIT_GENERAL_ERROR, EXIT_OK } from "../exit-codes.js";
import { formatJson, type CommandResult } from "../output/format.js";
import { toErrorMessage } from "../errors.js";
import {
  ApprovalDeclinedError,
  runApprovalFlow,
  type ApprovalPromptIo,
} from "../approval/prompt.js";
import { verifyApprovalTokenDurable } from "../approval/durable-approval-ledger.js";
import { verifySignature } from "../approval/token.js";
import { promoteProposal, rollbackProposal, type LearningReviewTokenVerifier } from "@eo/learning";
import type { LearningDependencies } from "./learning-dependencies.js";

const LEARNING_REVIEW_SUBJECT_KIND = "learning_review" as const;
const REQUIRED_DISTINCT_APPROVALS = 2;

/** Binds an independent-review token to BOTH the proposal's identity AND its current content — a stale/tampered content string would no longer verify against a token minted for the ORIGINAL content. */
function computeReviewDigest(proposalId: string, content: string): string {
  return createHash("sha256").update(`${proposalId}:${content}`).digest("hex");
}

function resolveIo(deps: LearningDependencies): ApprovalPromptIo {
  return deps.io ?? { input: process.stdin, output: process.stdout };
}

/**
 * The REAL `LearningReviewTokenVerifier` this backend injects into
 * `@eo/learning`'s `ProposalRegistry.recordReviewApproval` — this is the
 * ONLY place in the whole system a `learning_review` token is ever
 * genuinely checked, and it is 11's OWN mechanism (`verifyApprovalTokenDurable`,
 * unmodified) reused verbatim, never a second implementation.
 *
 * ADVERSARIAL-VALIDATION FIX (2026-07-24): `@eo/learning`'s promotion
 * guard previously trusted a caller-supplied `{tokenId, verifiedAt}`
 * object BY NAME, with no authenticity/subject/binding check performed
 * ANYWHERE — two fabricated strings promoted a proposal. This function is
 * what closes that hole: it recomputes the EXPECTED digest from the
 * `proposal` argument `recordReviewApproval` itself passes in (the
 * registry's own current, stored proposal — never a possibly-stale
 * closure value), so the binding check is against live data, and it
 * durably verifies the token's signature/expiry/subject/single-use via
 * `verifyApprovalTokenDurable` BEFORE ever returning a `tokenId` the
 * registry will accept.
 */
function buildLearningReviewTokenVerifier(deps: LearningDependencies): LearningReviewTokenVerifier {
  return async (rawToken: string, proposal: LearningProposal) => {
    const digest = computeReviewDigest(proposal.id, proposal.content);

    // Durable, cross-process, single-use verification — 11's own
    // mechanism (`packages/cli/src/approval/durable-approval-ledger.ts`),
    // unmodified. Throws (signature/expiry/subject/digest mismatch,
    // replay) — the throw propagates unchanged to `recordReviewApproval`,
    // which records NOTHING on a throw.
    await verifyApprovalTokenDurable(
      rawToken,
      { subjectKind: LEARNING_REVIEW_SUBJECT_KIND, digest },
      {
        secretKey: deps.secretKey,
        journal: deps.journal,
        ...(deps.clock !== undefined ? { clock: deps.clock } : {}),
      },
    );

    // ALSO mark the token consumed on `deps.minter`'s own in-memory
    // ledger (correct for same-process, sequential callers per that
    // method's own doc comment — exactly this backend's usage pattern
    // within one CLI process) so `ApprovalTokenMinter.mint`'s own
    // "still-pending, return the SAME token" dedup (`../approval/
    // token.ts`) never hands out the SAME token for a second, later
    // `learn approve` call against the IDENTICAL (subjectKind, digest).
    // If this in-memory check somehow disagrees with the durable ledger
    // above, it throws too — fail closed, never silently proceed on an
    // inconsistency between the two ledgers.
    deps.minter.verify(rawToken, { subjectKind: LEARNING_REVIEW_SUBJECT_KIND, digest });

    const { tokenId } = verifySignature(deps.secretKey, rawToken);
    return { tokenId };
  };
}

export async function runLearnListCommand(
  cmd: LearnListCommand,
  deps: LearningDependencies,
): Promise<CommandResult> {
  const proposals = await deps.registry.list();
  if (cmd.json) {
    return { exitCode: EXIT_OK, stdout: formatJson({ proposals }) };
  }
  if (proposals.length === 0) {
    return { exitCode: EXIT_OK, stdout: "no learning proposals recorded yet\n" };
  }
  const lines = proposals.map((p) => `- ${p.id} [${p.state}] ${p.content}`);
  return { exitCode: EXIT_OK, stdout: `${lines.join("\n")}\n` };
}

export async function runLearnApproveCommand(
  cmd: LearnApproveCommand,
  deps: LearningDependencies,
): Promise<CommandResult> {
  const proposal = await deps.registry.get(cmd.proposalId);
  if (proposal === undefined) {
    return { exitCode: EXIT_GENERAL_ERROR, stderr: `unknown proposal "${cmd.proposalId}"\n` };
  }
  if (proposal.state !== "independent_review") {
    return {
      exitCode: EXIT_GENERAL_ERROR,
      stderr:
        `proposal "${cmd.proposalId}" is not awaiting independent review ` +
        `(current state: "${proposal.state}")\n`,
    };
  }

  const digest = computeReviewDigest(proposal.id, proposal.content);

  let minted;
  try {
    minted = await runApprovalFlow(
      deps.minter,
      LEARNING_REVIEW_SUBJECT_KIND,
      digest,
      resolveIo(deps),
    );
  } catch (err) {
    if (err instanceof ApprovalDeclinedError) {
      return {
        exitCode: EXIT_OK,
        stdout: "independent review declined at the terminal prompt — no token minted\n",
      };
    }
    return { exitCode: EXIT_GENERAL_ERROR, stderr: `${toErrorMessage(err)}\n` };
  }

  // Verification happens INSIDE `@eo/learning`'s own registry, via the
  // injected verifier below — never trusted by this backend's own claim.
  // A throw here (bad signature, wrong subject, wrong binding, expired,
  // replayed) propagates as-is; nothing is recorded.
  let reviewApprovals;
  try {
    ({ reviewApprovals } = await deps.registry.recordReviewApproval(
      proposal.id,
      minted.token,
      buildLearningReviewTokenVerifier(deps),
    ));
  } catch (err) {
    return { exitCode: EXIT_GENERAL_ERROR, stderr: `${toErrorMessage(err)}\n` };
  }

  const distinctCount = new Set(reviewApprovals.map((a) => a.tokenId)).size;
  if (distinctCount < REQUIRED_DISTINCT_APPROVALS) {
    const message =
      `recorded independent-review approval ${String(distinctCount)}/` +
      `${String(REQUIRED_DISTINCT_APPROVALS)} for proposal "${proposal.id}" — ` +
      "awaiting at least one more DISTINCT reviewer approval before promotion\n";
    return cmd.json
      ? {
          exitCode: EXIT_OK,
          stdout: formatJson({ promoted: false, distinctApprovals: distinctCount }),
        }
      : { exitCode: EXIT_OK, stdout: message };
  }

  try {
    const result = await promoteProposal({
      registry: deps.registry,
      proposalId: proposal.id,
      changeSetRefs: deps.changeSetRefs,
    });
    return cmd.json
      ? { exitCode: EXIT_OK, stdout: formatJson({ promoted: true, changeSet: result.changeSet }) }
      : {
          exitCode: EXIT_OK,
          stdout:
            `proposal "${proposal.id}" PROMOTED — ChangeSet ${result.changeSet.id} constructed ` +
            "for the normal scheduler->gates->publish pipeline\n",
        };
  } catch (err) {
    return { exitCode: EXIT_GENERAL_ERROR, stderr: `${toErrorMessage(err)}\n` };
  }
}

export async function runLearnRejectCommand(
  cmd: LearnRejectCommand,
  deps: LearningDependencies,
): Promise<CommandResult> {
  const proposal = await deps.registry.get(cmd.proposalId);
  if (proposal === undefined) {
    return { exitCode: EXIT_GENERAL_ERROR, stderr: `unknown proposal "${cmd.proposalId}"\n` };
  }
  try {
    const rejected = await deps.registry.transition(cmd.proposalId, "rejected");
    return cmd.json
      ? { exitCode: EXIT_OK, stdout: formatJson({ rejected: true, proposal: rejected }) }
      : { exitCode: EXIT_OK, stdout: `proposal "${cmd.proposalId}" rejected\n` };
  } catch (err) {
    return { exitCode: EXIT_GENERAL_ERROR, stderr: `${toErrorMessage(err)}\n` };
  }
}

export async function runLearnRollbackCommand(
  cmd: LearnRollbackCommand,
  deps: LearningDependencies,
): Promise<CommandResult> {
  const proposal = await deps.registry.get(cmd.proposalId);
  if (proposal === undefined) {
    return { exitCode: EXIT_GENERAL_ERROR, stderr: `unknown proposal "${cmd.proposalId}"\n` };
  }
  try {
    const result = await rollbackProposal({
      registry: deps.registry,
      proposalId: cmd.proposalId,
      changeSetRefs: deps.changeSetRefs,
    });
    return cmd.json
      ? {
          exitCode: EXIT_OK,
          stdout: formatJson({ rolledBack: true, inverseChangeSet: result.inverseChangeSet }),
        }
      : {
          exitCode: EXIT_OK,
          stdout:
            `proposal "${cmd.proposalId}" ROLLED BACK — inverse ChangeSet ` +
            `${result.inverseChangeSet.id} constructed to restore the baseline\n`,
        };
  } catch (err) {
    return { exitCode: EXIT_GENERAL_ERROR, stderr: `${toErrorMessage(err)}\n` };
  }
}
