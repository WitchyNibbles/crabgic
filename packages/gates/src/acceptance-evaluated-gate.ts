import {
  ACCEPTANCE_EVIDENCE_PREFIXES,
  describeObservations,
  unevaluatedRequirements,
  type Requirement,
} from "@crabgic/contracts";
import { findAcceptanceEvaluations } from "@crabgic/journal";
import type { GateRegistry } from "./registry.js";
import type { GateContext, GateVerdict } from "./types.js";

/**
 * The acceptance-EVALUATED gate — owner ruling R5 (2026-08-16).
 *
 * WHAT IT REFUSES, and why the seal gate beside it does not already.
 * `registerCriteriaSealGate` asks whether the criteria a candidate is being
 * published against are the criteria that were APPROVED. That is anti-tamper,
 * and on both of the runs that reached `published_local` it passed correctly —
 * nothing had been tampered with. Nothing anywhere asked the other question:
 * whether those criteria were ever EVALUATED. This gate is that question, and
 * the two are complementary rather than overlapping — a run can satisfy either
 * one while failing the other.
 *
 * WHY IT MUST NAME WHAT WENT UNVERIFIED. The ruling is explicit that a bare
 * refusal trades a false pass for an unactionable failure, and the run holds the
 * material to be precise: the criteria are sealed at approval, and R5's observer
 * writes down which granted commands actually ran. So the verdict's `detail`
 * carries every unevaluated requirement with its own acceptance criteria, plus
 * what each work unit was observed doing, plus the grants that would satisfy it.
 *
 * ⚠️ WHAT PASSING THIS GATE DOES AND DOES NOT ESTABLISH. It establishes that at
 * least one command classed `acceptance` ran clean for every requirement in the
 * change set's basis. It does NOT establish that the evaluation was adequate — a
 * filtered suite and a full one look identical here. That bound is stated on
 * `AcceptanceEvaluationRecord` and is R6's and phase 14's territory, not this
 * gate's. What it closes is the measured hole: publication on a self-report that
 * nothing checked.
 *
 * ⚠️ AN INHERITED RESIDUAL, disclosed rather than left for a reader to work out.
 * This gate is only as trustworthy as the journal it reads. Under the default
 * single-account deployment the journal is writable by every process the
 * operator's account starts, workers included, and the chain is a plain SHA-256
 * with no secret — so a worker with a write path could forge an observation
 * saying its tests ran. That is NOT a hole this gate opens: the criteria seal it
 * fires beside has the identical exposure, and `docs/operator-guide.md` §11b
 * documents the two mitigations (writer separation by uid, and off-host head
 * anchoring) together with their honest limits. What R5 adds is one more record
 * that is worth forging, and it is worth stating that the countermeasure is
 * deployment posture rather than anything in this file.
 *
 * WHY IT CLEARS THE DAEMON-PROCESS ADMISSION TEST. It runs no stack command, no
 * subprocess, no measurement and no engine — it is a journal read plus a set
 * difference, exactly like the seal gate. See
 * `packages/cli/src/daemon/compose-gate-registry.ts` for that rule.
 *
 * DISCLOSED COST, because it is a change in what the product promises rather
 * than a maintenance fix: with this registered, both runs recorded in
 * `docs/evidence/phase-25/published-unverified.md` become refused runs, and on a
 * host where the granted test command cannot run, nothing publishes. The owner
 * accepted that when the ruling was made, and it is the ruling's point: it
 * converts a host limitation into a stated refusal.
 */
export interface AcceptanceEvaluatedGateOptions {
  /**
   * The ChangeSet's requirement records, as they stand at gate time. A function
   * rather than a value for the same reason the seal gate's is: reading at
   * registration would pin a snapshot taken before the work ran.
   */
  readonly requirements: (context: GateContext) => readonly Requirement[];
  /** Overridable for deterministic tests; defaults to this package's own name. */
  readonly toolchainFingerprint?: string;
}

const COMMAND = "eo-gates: acceptance-criteria evaluation check";

/** The gate's registered name — shared with `COMPOSED_GATE_NAMES` so the two cannot drift. */
export const ACCEPTANCE_EVALUATED_GATE_NAME = "acceptance-evaluated";

export function registerAcceptanceEvaluatedGate(
  registry: GateRegistry,
  options: AcceptanceEvaluatedGateOptions,
): void {
  registry.register(
    "acceptance",
    ACCEPTANCE_EVALUATED_GATE_NAME,
    async (context): Promise<GateVerdict> => {
      const records = await findAcceptanceEvaluations(context.journal, context.changeSetId);
      const requirements = options.requirements(context);
      const unevaluated = unevaluatedRequirements(requirements, records, context.changeSetId);
      const toolchainFingerprint = options.toolchainFingerprint ?? "@crabgic/gates";

      /**
       * ⚠️ THE EMPTY BASIS, refused explicitly — because `unevaluated.length > 0`
       * alone would let it PASS.
       *
       * "Every requirement was evaluated" is a universal quantifier, and over an
       * empty set it is vacuously true. A change set that declares no
       * requirements would therefore satisfy the strongest acceptance gate this
       * system has by declaring nothing to satisfy, which is the exact vacuity
       * pattern `docs/verification-playbook.md` exists to refuse — arriving, as
       * it happens, at the top level of the product.
       *
       * It is reachable, not theoretical: `transitionChangeSetToReady` refuses
       * an UNMAPPED requirement and a requirement with no record to seal, and
       * refuses NEITHER a change set that declares none at all. So a planner
       * that emitted work units carrying empty `requirementIds` would publish
       * unconditionally and the seal gate would agree with it — it seals an
       * empty set without complaint.
       *
       * Refusing here is also the correct reading of the ruling. A run that
       * verified nothing because there was nothing to verify has still not
       * verified anything, and `published_local` would still be claiming it did.
       */
      if (requirements.length === 0) {
        return {
          passed: false,
          command: COMMAND,
          exitStatus: 1,
          toolchainFingerprint,
          artifactDigests: [],
          detail: JSON.stringify({
            refusal:
              "this change set declares no acceptance criteria at all, so there is " +
              "nothing publication could have been verified against",
            unevaluated: [],
            observed: describeObservations(records, context.changeSetId),
            satisfiedBy: ACCEPTANCE_EVIDENCE_PREFIXES,
          }),
        };
      }

      if (unevaluated.length > 0) {
        /**
         * A blocking VERDICT rather than a throw, so `emitEvidence` still
         * journals the refusal — the same choice the seal gate and the perf
         * gate make, and for the same reason: a gate that throws leaves no
         * record that it refused, and this is the refusal most worth being able
         * to read back.
         */
        return {
          passed: false,
          command: COMMAND,
          exitStatus: 1,
          toolchainFingerprint,
          artifactDigests: [],
          detail: JSON.stringify({
            refusal:
              "the acceptance criteria below were never evaluated — no granted " +
              "acceptance-class command ran clean for them",
            unevaluated,
            observed:
              records.length === 0
                ? ["no attempt recorded what it ran for this change set"]
                : describeObservations(records, context.changeSetId),
            satisfiedBy: ACCEPTANCE_EVIDENCE_PREFIXES,
          }),
        };
      }

      return {
        passed: true,
        command: COMMAND,
        exitStatus: 0,
        toolchainFingerprint,
        artifactDigests: [],
        detail: JSON.stringify({
          /**
           * The count of requirements EVALUATED, not of records read. A run with
           * five records and no requirements has verified nothing and must not
           * read as a stronger pass than one with a single covered requirement.
           */
          evaluatedRequirements: requirements.length,
          records: records.length,
        }),
      };
    },
  );
}
