import { formatJson, type CommandResult } from "@crabgic/contracts";
import type { OwnerDesignVerdict } from "@crabgic/contracts";
import { EXIT_OK, EXIT_USAGE_ERROR } from "../exit-codes.js";
import { recordDesignVerdict } from "../review/design-verdict-store.js";
import type { DesignVerdictCommand } from "../argv/types.js";

/**
 * `crabgic design approve|reject` — the design gate's write path.
 * Owner ruling R2 (2026-08-15); roadmap/25 work item 5.
 *
 * WHY THIS IS A CLI COMMAND AND NOT A GATEWAY TOOL, restated at the call site
 * because it is the whole reason the gate is a gate: nothing reachable from a
 * session may record this verdict. The gateway registry reads the store and
 * exposes no tool that writes it (asserted in `build-tool-registry.test.ts`), so
 * the only writer is an operator typing on their own terminal. Ledger Gap 18
 * draws the identical line around the `EnvelopePolicy`, for the identical
 * reason: a model that can satisfy its own approval gate has no gate.
 *
 * The timestamp is taken HERE rather than accepted as an argument. A caller
 * supplying `recordedAt` could backdate a verdict, and the only thing that field
 * is for is telling a later reader when the owner actually answered.
 */

export interface DesignVerdictHandlerDeps {
  /** Where the verdict store lives — resolved by the composition root, never here. */
  readonly designVerdictsPath: string;
  readonly stateHome: string;
  /** Injected so the emitted record is deterministic under test. */
  readonly now?: () => Date;
}

export async function runDesignVerdictCommand(
  command: DesignVerdictCommand,
  deps: DesignVerdictHandlerDeps,
): Promise<CommandResult> {
  const verdict: OwnerDesignVerdict = {
    schemaVersion: 1,
    changeSetId: command.changeSetId,
    designRevision: command.revision,
    verdict: command.command === "design-approve" ? "approved" : "rejected",
    ...(command.reason !== undefined ? { reason: command.reason } : {}),
    recordedAt: (deps.now?.() ?? new Date()).toISOString(),
  };

  try {
    await recordDesignVerdict(deps.designVerdictsPath, verdict, deps.stateHome);
  } catch (error) {
    /**
     * Refused, and the reason is surfaced verbatim.
     *
     * The store refuses an invalid document, a symlinked path and a foreign
     * owner. An operator who is told only "failed" cannot tell a typo from a
     * tampered state directory, and those need different responses.
     */
    const reason = error instanceof Error ? error.message : String(error);
    return {
      exitCode: EXIT_USAGE_ERROR,
      stderr: `${reason}\n`,
      ...(command.json ? { stdout: formatJson({ ok: false, error: reason }) } : {}),
    };
  }

  if (command.json) {
    return { exitCode: EXIT_OK, stdout: formatJson({ ok: true, verdict }) };
  }

  const headline =
    verdict.verdict === "approved"
      ? `Design approved for change set ${verdict.changeSetId}.`
      : `Design rejected for change set ${verdict.changeSetId}.`;
  const lines = [
    headline,
    `Revision: ${verdict.designRevision}`,
    ...(verdict.reason !== undefined ? [`Reason: ${verdict.reason}`] : []),
    verdict.verdict === "approved"
      ? "The design-gate stage can now close for this revision. Editing the design re-closes it."
      : "The design stage will loop with this reason attached.",
  ];
  return { exitCode: EXIT_OK, stdout: `${lines.join("\n")}\n` };
}
