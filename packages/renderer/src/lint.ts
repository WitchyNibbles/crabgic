import type { CommunicationPolicy } from "@eo/contracts";
import { adfSafeSubsetStage } from "./adf.js";
import type { ArtifactKind } from "./artifact-kind.js";
import { attributionNeutralStage } from "./attribution-neutral.js";
import { evidenceClaimsStage } from "./evidence-claims.js";
import { lengthLimitsStage } from "./length-limits.js";
import type { LintOutcome, LintStage, LintStageInput } from "./lint-types.js";
import { mentionPolicyStage } from "./mention-policy.js";
import { metadataStripStage } from "./metadata-strip.js";
import { schemaValidationStage } from "./schema-validation.js";
import { secretScanStage } from "./secret-scan.js";
import { nfcNormalizationStage, unicodeDefenseStage } from "./unicode-defense.js";
import { urlPolicyStage } from "./url-policy.js";

export type { LintFinding, LintOutcome, LintStageInput, LintStage } from "./lint-types.js";

/**
 * The ordered stage pipeline — roadmap/17 §Goal's arrow-chain, verbatim
 * order: schema validation → strip metadata → NFC normalization → reject
 * bidi/controls/zero-width/confusables → secret/token scan → URL policy →
 * ADF safe-node/mark subset → attribution-neutral language → whitespace/
 * line/length limits → evidence-required claims → mention/notification
 * policy. Exported so a runner-order fixture (roadmap/17 work item 1's
 * failing-first test) can assert the exact sequence independently of any
 * single stage's internal logic.
 */
export const STAGE_PIPELINE: readonly LintStage[] = [
  schemaValidationStage,
  metadataStripStage,
  nfcNormalizationStage,
  unicodeDefenseStage,
  secretScanStage,
  urlPolicyStage,
  adfSafeSubsetStage,
  attributionNeutralStage,
  lengthLimitsStage,
  evidenceClaimsStage,
  mentionPolicyStage,
];

/**
 * `lint(candidate, kind, policy): LintOutcome` — roadmap/17 §Interfaces
 * produced, verbatim signature. Pure, synchronous, single ordered pass over
 * `STAGE_PIPELINE`; every stage runs (no short-circuiting on the first
 * failing stage) so a caller sees every violation in the candidate at once,
 * not just the first one encountered — matching `LintFinding`'s own design
 * rationale ("never a bare boolean").
 */
export function lint(candidate: string, kind: ArtifactKind, policy: CommunicationPolicy): LintOutcome {
  const input: LintStageInput = { candidate, kind, policy };
  const findings = STAGE_PIPELINE.flatMap((stage) => stage(input));
  return findings.length === 0 ? { ok: true } : { ok: false, findings };
}
