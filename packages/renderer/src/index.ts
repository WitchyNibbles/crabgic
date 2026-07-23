/**
 * `@eo/renderer` public barrel — roadmap/17-renderer-communication-lint.md
 * §Interfaces produced. Downstream phases (08, 18, 19, 20) import from
 * `@eo/renderer` directly.
 */

// ArtifactKind — the closed union introduced by this phase.
export { ARTIFACT_KINDS, isArtifactKind, type ArtifactKind } from "./artifact-kind.js";

// LintFinding / LintOutcome / lint() — the blocking lint pipeline.
export type { LintFinding, LintOutcome, LintStage, LintStageInput } from "./lint-types.js";
export { lint, STAGE_PIPELINE } from "./lint.js";

// renderWithRegeneration() — the regenerate-once orchestration.
export {
  renderWithRegeneration,
  type CandidateGenerator,
  type RenderOutcome,
  type RenderWithRegenerationInput,
} from "./render-with-regeneration.js";

// toADF / toWikiMarkup — Jira Cloud/DC converters.
export {
  ADF_ALLOWED_MARK_TYPES,
  ADF_ALLOWED_NODE_TYPES,
  toADF,
  validateAdfSafeSubset,
  type AdfDocument,
  type AdfMark,
  type AdfNode,
} from "./adf.js";
export { toWikiMarkup } from "./wiki-markup.js";

// Templates.
export { renderJiraMilestoneComment, type JiraMilestoneCommentInput } from "./templates/jira-milestone-comment.js";
export { renderGrafanaAnnotation, type GrafanaAnnotationInput } from "./templates/grafana-annotation.js";
export { renderPrTitle, type PrTitleInput } from "./templates/pr-title.js";
export { renderPrBody, type PrBodyInput } from "./templates/pr-body.js";
export { renderReviewComment, type ReviewCommentInput } from "./templates/review-comment.js";

// Unicode-defense primitives (exposed for callers/fixture authors that want
// direct access, e.g. 23's release-gate corpus re-invocation).
export { normalizeToNfc } from "./unicode-defense.js";

// Individual stage names, exposed so a caller can filter/inspect findings
// by stage without re-deriving each string literal.
export { STAGE_NAME_SCHEMA_VALIDATION } from "./schema-validation.js";
export { STAGE_NAME_METADATA_STRIP } from "./metadata-strip.js";
export { STAGE_NAME_NFC_NORMALIZATION, STAGE_NAME_UNICODE_DEFENSE } from "./unicode-defense.js";
export { STAGE_NAME_SECRET_SCAN } from "./secret-scan.js";
export { STAGE_NAME_URL_POLICY } from "./url-policy.js";
export { STAGE_NAME_ADF_SAFE_SUBSET } from "./adf.js";
export { STAGE_NAME_ATTRIBUTION_NEUTRAL } from "./attribution-neutral.js";
export { STAGE_NAME_LENGTH_LIMITS } from "./length-limits.js";
export { STAGE_NAME_EVIDENCE_CLAIMS } from "./evidence-claims.js";
export { STAGE_NAME_MENTION_POLICY } from "./mention-policy.js";
