import type { JournalStore } from "@eo/journal";
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
  /** Absent at `final_verifying` — that firing verifies the integrated candidate as a whole, with no single owning `WorkUnit` (mirrors `EvidenceRecord.workUnitId`'s own optionality, `@eo/contracts`). */
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
}

export type GateHandler = (context: GateContext) => Promise<GateVerdict>;

export interface RegisteredGate {
  readonly tag: GateRiskTag;
  readonly name: string;
  readonly handler: GateHandler;
}
