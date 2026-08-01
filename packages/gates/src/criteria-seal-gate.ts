import { verifyCriteriaSeal, type Requirement } from "@crabgic/contracts";
import { findLatestCriteriaSeal } from "@crabgic/journal";
import type { GateRegistry } from "./registry.js";
import type { GateContext, GateVerdict } from "./types.js";

/**
 * The acceptance-criteria seal gate — roadmap/24 WI6.
 *
 * WHY A GATE AT ALL, when 13's executor already refuses a tampered
 * completion. The executor check is per work unit, at the moment that unit's
 * success is accepted. This one fires ONCE at `final_verifying`, against the
 * integrated candidate as a whole, and its job is different in two ways that
 * matter:
 *
 *   - It covers the ChangeSet's WHOLE requirement set, including requirements
 *     whose owning unit succeeded long before some later unit was dispatched.
 *     A tamper landing after a unit already passed is invisible to that
 *     unit's own completed check and visible here.
 *   - It puts the answer ON RECORD as an `EvidenceRecord`, so "were the
 *     criteria this candidate is being published against the ones that were
 *     approved" is answerable after the fact from the journal, rather than
 *     only in the moment.
 *
 * Registered under the EXISTING `acceptance` risk tag — one of the 13
 * `GATE_RISK_TAGS`, itself derived from the IntentContract's own section
 * keys. No new tag: the question "does this candidate meet its acceptance
 * criteria" is precisely what that tag already names.
 */
export interface CriteriaSealGateOptions {
  /**
   * The ChangeSet's requirement records, as they stand at gate time. A
   * function rather than a value because the gate must read them WHEN it
   * fires — reading them at registration would pin a snapshot taken before
   * the work ran, which is exactly the window a tamper lives in.
   */
  readonly requirements: (context: GateContext) => readonly Requirement[];
  /** Overridable for deterministic tests; defaults to this package's own name. */
  readonly toolchainFingerprint?: string;
}

const COMMAND = "eo-gates: acceptance-criteria seal verification";

export function registerCriteriaSealGate(
  registry: GateRegistry,
  options: CriteriaSealGateOptions,
): void {
  registry.register("acceptance", "criteria-seal", async (context): Promise<GateVerdict> => {
    const approvalSeal = await findLatestCriteriaSeal(context.journal, context.changeSetId);
    const failures = options
      .requirements(context)
      .map((requirement) => ({
        requirement,
        result: verifyCriteriaSeal(requirement, approvalSeal),
      }))
      .filter((checked) => !checked.result.ok);

    const toolchainFingerprint = options.toolchainFingerprint ?? "@crabgic/gates";

    // A refusal is converted into a BLOCKING VERDICT rather than thrown, so
    // `emitEvidence` still journals it — the same deliberate choice
    // `packages/perf`'s gate makes for a hash-link failure, and for the same
    // reason: a gate that throws leaves no record that it refused.
    if (failures.length > 0) {
      return {
        passed: false,
        command: COMMAND,
        exitStatus: 1,
        toolchainFingerprint,
        artifactDigests: [],
        detail: JSON.stringify({
          failures: failures.map((checked) => ({
            requirementId: checked.requirement.id,
            reason: checked.result.reason,
          })),
        }),
      };
    }

    return {
      passed: true,
      command: COMMAND,
      exitStatus: 0,
      toolchainFingerprint,
      artifactDigests: [],
      detail: JSON.stringify({ verified: options.requirements(context).length }),
    };
  });
}
