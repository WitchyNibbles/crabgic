import {
  FULL_FAULT_MATRIX,
  authFailureResponse,
  conflictResponse,
  malformedPageResponse,
  midPostTimeoutFault,
  preconditionFailedResponse,
  rateLimitedResponse,
  type FakeProviderScriptEntry,
} from "@eo/gateway";

/**
 * Jira Cloud fault matrix — roadmap/18 §Interfaces produced: "Fault
 * matrix: 401/403/409/429, malformed pagination, ambiguous mid-POST
 * timeout." Extends (never reimplements) `@eo/gateway`'s
 * `FULL_FAULT_MATRIX`/canned-fault builders — this connector's own
 * addition is only a `forbidden` (403) entry, since 16's matrix already
 * covers 401/409/412/429/malformed-page/mid-POST-timeout verbatim under
 * those exact names.
 */
export const JIRA_FAULT_MATRIX: Readonly<Record<string, FakeProviderScriptEntry>> = {
  ...FULL_FAULT_MATRIX,
  forbidden: { status: 403, bodyText: "" },
};

export {
  authFailureResponse,
  conflictResponse,
  malformedPageResponse,
  midPostTimeoutFault,
  preconditionFailedResponse,
  rateLimitedResponse,
};
