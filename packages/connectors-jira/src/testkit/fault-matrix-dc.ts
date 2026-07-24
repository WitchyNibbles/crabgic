import { FULL_FAULT_MATRIX, type FakeProviderScriptEntry } from "@eo/gateway";

/**
 * Jira Data Center fault matrix — roadmap/19-jira-datacenter-adapter.md §In
 * scope, "Rate limits": "DC deployments typically have no Cloud-style
 * quota/burst headers ... this phase's fixtures must not assert a
 * `Retry-After` contract DC doesn't make — conformance parameterization
 * treats rate-limit-header presence as a per-deployment-type fixture
 * property, not a shared assertion." Extends (never reimplements)
 * `@eo/gateway`'s `FULL_FAULT_MATRIX`, mirroring `../testkit/fault-
 * matrix.ts`'s Cloud extension (a `forbidden` 403 entry), but OVERRIDES
 * `rateLimited` with a bare 429 carrying NO `retry-after` header — the one
 * deliberate, documented divergence from Cloud's fault matrix.
 */
const DC_RATE_LIMITED_NO_RETRY_AFTER: FakeProviderScriptEntry = { status: 429, bodyText: "" };

export const JIRA_DATACENTER_FAULT_MATRIX: Readonly<Record<string, FakeProviderScriptEntry>> = {
  ...FULL_FAULT_MATRIX,
  rateLimited: DC_RATE_LIMITED_NO_RETRY_AFTER,
  forbidden: { status: 403, bodyText: "" },
};
