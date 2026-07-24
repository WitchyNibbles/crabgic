import { ConnectorError, DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { toADF, validateAdfSafeSubset, type AdfDocument } from "@eo/renderer";
import { JIRA_PROVIDER_NAME } from "../errors/jira-error-mapping.js";

/**
 * Intake resolution — roadmap/18 §In scope: "a referenced issue key/URL
 * becomes the tracking item; otherwise a concise draft rendered through
 * 17, created only post-approval. Local `IntentContract` stays
 * authoritative." This module resolves the FIRST half (reference
 * detection) and validates a draft's Jira-specific shape (summary length,
 * ADF-safe description) — the `IntentContract` itself and the
 * approval-gating workflow are 11's contracts/flow, consumed here, never
 * reimplemented.
 */

/** Matches a bare Jira issue key: 1+ uppercase letters, a hyphen, 1+ digits. */
const BARE_ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]*-[0-9]+$/;
/** Matches an issue key embedded in a Jira Cloud `/browse/<KEY>` URL path segment. */
const BROWSE_URL_ISSUE_KEY_PATTERN = /\/browse\/([A-Z][A-Z0-9]*-[0-9]+)(?:[/?#]|$)/;

/**
 * Extracts a Jira issue key from a caller-supplied reference — a bare
 * key ("PROJ-123") or a Jira Cloud browse URL. Returns `undefined` (never
 * guesses) when no recognizable key is present, so the caller correctly
 * falls through to the draft-creation path instead of tracking a
 * fabricated key.
 */
export function extractJiraIssueKeyFromReference(reference: string): string | undefined {
  const trimmed = reference.trim();
  if (BARE_ISSUE_KEY_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const match = BROWSE_URL_ISSUE_KEY_PATTERN.exec(trimmed);
  return match?.[1];
}

/**
 * Validates a draft issue's summary against `CommunicationPolicy`'s
 * `jiraSummary` limit (02-owned constant, 17-enforced elsewhere for
 * rendered artifacts; this connector applies the same limit directly
 * since issue-summary drafting has no dedicated `ArtifactKind` member
 * for `renderWithRegeneration` to gate — see this file's own module
 * doc comment).
 */
export function validateDraftIssueSummary(summary: string): void {
  const trimmed = summary.trim();
  if (trimmed.length === 0) {
    throw ConnectorError.validation({
      message: "draft issue summary must not be blank",
      provider: JIRA_PROVIDER_NAME,
      retryable: false,
    });
  }
  const maxChars = DEFAULT_COMMUNICATION_POLICY.limits.jiraSummary.maxChars;
  if (trimmed.length > maxChars) {
    throw ConnectorError.validation({
      message: `draft issue summary exceeds the ${maxChars}-character Jira summary limit`,
      provider: JIRA_PROVIDER_NAME,
      retryable: false,
    });
  }
}

/**
 * Converts a draft issue description to ADF and independently re-
 * validates the safe subset (defense-in-depth, mirroring `@eo/renderer`'s
 * own `adf.ts` doc comment on why `validateAdfSafeSubset` is a separate
 * walker) before it is ever embedded in an `issue.create` plan's
 * payload. Throws `ConnectorError.policyBlocked` if the independent
 * validator finds a disallowed node/mark — which `toADF` itself should
 * never produce, but this connector never trusts that invariant blindly.
 */
export function buildDraftIssueDescriptionAdf(descriptionMarkdown: string): AdfDocument {
  const adf = toADF(descriptionMarkdown);
  const findings = validateAdfSafeSubset(adf);
  if (findings.length > 0) {
    throw ConnectorError.policyBlocked({
      message: `draft issue description failed ADF safe-subset validation: ${findings.map((f) => f.message).join("; ")}`,
      provider: JIRA_PROVIDER_NAME,
      retryable: false,
    });
  }
  return adf;
}
