import type { JournalStore } from "@crabgic/journal";
import type { GateRiskTag } from "./risk-tags.js";

/**
 * `GateContext` — what the registry hands every registered handler when it
 * fires. `objectId` is the EXACT Git object id under test (roadmap/14 §In
 * scope: "the exact object ID under test") — for a `verifying`-stage
 * (per-work-unit) firing this is the attempt's own candidate object id; for
 * a `final_verifying`-stage firing (work item 6) this is the truly-
 * integrated candidate object id 08 already froze, never a cached
 * per-work-unit value.
 */
export interface GateContext {
  readonly stage: "verifying" | "final_verifying";
  readonly changeSetId: string;
  readonly objectId: string;
  readonly requirementId?: string;
  /** Absent at `final_verifying` — that firing verifies the integrated candidate as a whole, with no single owning `WorkUnit` (mirrors `EvidenceRecord.workUnitId`'s own optionality, `@crabgic/contracts`). */
  readonly workUnitId?: string;
  readonly journal: JournalStore;
  /** Overridable clock for deterministic tests; defaults to the real wall clock. */
  readonly now?: () => Date;
}

/**
 * `GateVerdict` — a gate handler's own pass/fail judgment plus the raw
 * material `../evidence.ts`'s `emitEvidence` turns into one `EvidenceRecord`
 * per firing (roadmap/14 §In scope: "command, exit status, env/toolchain
 * fingerprint, timestamp, artifact digests, exact object ID"). This
 * package's gate verdicts are the evidentiary basis 05/13 use to drive an
 * attempt's `succeeded`/`failed` `WorkUnitAttemptStatus` — this package
 * never transitions that enum itself (roadmap/14 §Interfaces consumed).
 */
export interface GateVerdict {
  readonly passed: boolean;
  readonly command: string;
  readonly exitStatus: number;
  readonly toolchainFingerprint: string;
  readonly artifactDigests: readonly string[];
  readonly detail: string;
  /** Set by the flake gate (`../flake-gate.ts`) for a rerun-then-pass result — "never silently green" (roadmap/14 §In scope, "Flake policy"). Other gates leave this `undefined`. */
  readonly unstable?: boolean;
  /**
   * ⚠️ THE THIRD STATE: this gate RAN and established nothing.
   *
   * `passed` is a claim about the candidate. `inconclusive` says no claim was
   * made — the check's own precondition could not be met, so the gate never got
   * as far as asking the question. It blocks nothing, and it proves nothing.
   *
   * `../evidence.ts` emits the record with NO `gateVerdict` when this is set,
   * which is exactly the shape `@crabgic/cli`'s `deriveGateCriteria` treats as
   * unproven: "a gate-tagged record with no verdict is unproven rather than
   * presumed green." Reporting `passed: true` instead would derive the
   * criterion as MET on a check that never ran.
   *
   * It OVERRIDES `passed`, in both directions. A gate that could not establish
   * its precondition has not failed the candidate — it has failed to ask — so a
   * handler may set `passed: false` alongside this and still block nothing.
   */
  readonly inconclusive?: boolean;
}

export type GateHandler = (context: GateContext) => Promise<GateVerdict>;

/** Registration-time properties of a gate, as distinct from its per-firing inputs. */
export interface GateRegistrationOptions {
  /**
   * This gate judges ONE work unit's attempt and cannot judge the integrated
   * candidate as a whole, so `fireAll` — the final-candidate re-verification
   * primitive — skips it. `fireByTag` still fires it: that is its firing path.
   *
   * ⚠️ A PROPERTY OF THE REGISTRATION, NOT OF THE TAG, and deliberately so.
   * Excluding the `tdd` TAG at `final_verifying` would redden
   * `./final-candidate.test.ts:112`, which registers its own stub under that tag
   * and is cited by phase 14's closed exit criterion 8. A registrant declares
   * this about itself; the vocabulary is untouched.
   */
  readonly perWorkUnit?: boolean;
}

export interface RegisteredGate {
  readonly tag: GateRiskTag;
  readonly name: string;
  readonly handler: GateHandler;
  /** See `GateRegistrationOptions.perWorkUnit`. Always present on a listed gate, so a composition root can audit what fires where without guessing at an absent field. */
  readonly perWorkUnit: boolean;
}
