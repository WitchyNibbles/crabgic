/**
 * Stage 2 (pin) — roadmap/12 §In scope, "Quarantine pipeline" bullet:
 * "(2) pin immutable digest." Thin wrapper around `../digest.ts`'s
 * deterministic content-addressed digest — this stage always passes for
 * any well-shaped candidate (digest computation cannot fail for a value
 * that already passed stage 1's shape validation).
 */
import { computeCandidateDigest } from "../digest.js";
import type { CandidateSource, PinnedCandidate, StageResult } from "../types.js";

export interface PinStageOutcome {
  readonly result: StageResult;
  readonly pinned: PinnedCandidate;
}

export function runPinStage(candidate: CandidateSource): PinStageOutcome {
  const digest = computeCandidateDigest(candidate);
  return {
    result: { stage: "pin", passed: true, detail: `pinned digest ${digest}` },
    pinned: { ...candidate, digest },
  };
}
