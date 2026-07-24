/**
 * Stage 3 (verify_provenance) — roadmap/12 §In scope, "Quarantine
 * pipeline" bullet: "(3) verify signature/provenance where available."
 * §Risks: "SLSA/CycloneDX stored as evidence, not proof of benignity" —
 * an absent signature is NOT itself a failure (many legitimate first-party
 * capabilities have none), but a digest that CHANGED since a previous pin
 * with no valid new signature covering the change is rejected outright —
 * exercises roadmap/12's own named seeded threat: "unsigned digest change
 * post-pin" (§Test plan, "Security" bullet).
 */
import type { PinnedCandidate, StageResult } from "../types.js";

export interface SignatureVerifier {
  /** Returns `true` iff `signature` is a valid signature over `digest`. */
  verify(digest: string, signature: string): boolean;
}

/**
 * The default verifier: always reports "unverified" (`false`). No phase
 * has pinned a real PKI trust root for capability signatures anywhere in
 * this repo's cited source material — a real verifier can be injected via
 * `VerifyProvenanceOptions.verifier` once one exists, with no interface
 * change required here.
 */
export function createUnverifiedSignatureVerifier(): SignatureVerifier {
  return { verify: () => false };
}

export interface VerifyProvenanceOptions {
  readonly verifier?: SignatureVerifier;
  /** The digest this same candidate name was previously pinned at, if any (read from the capability store) — the tamper-detection input. */
  readonly previousDigest?: string;
}

export function runVerifyProvenanceStage(
  pinned: PinnedCandidate,
  options: VerifyProvenanceOptions = {},
): StageResult {
  const verifier = options.verifier ?? createUnverifiedSignatureVerifier();
  const signature = pinned.provenance?.signature;
  const signatureValid = signature !== undefined && verifier.verify(pinned.digest, signature);

  if (
    options.previousDigest !== undefined &&
    options.previousDigest !== pinned.digest &&
    !signatureValid
  ) {
    return {
      stage: "verify_provenance",
      passed: false,
      detail: `digest changed from ${options.previousDigest} to ${pinned.digest} with no valid new signature covering the change — rejected as an unsigned digest swap`,
    };
  }

  if (signature === undefined) {
    return {
      stage: "verify_provenance",
      passed: true,
      detail: "no signature provided; provenance recorded as evidence only, not proof of benignity",
    };
  }

  return {
    stage: "verify_provenance",
    passed: signatureValid,
    detail: signatureValid
      ? "signature accepted"
      : "signature present but failed verification against the pinned digest",
  };
}
