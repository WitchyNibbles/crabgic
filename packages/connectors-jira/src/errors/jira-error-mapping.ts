import type { ConnectorError } from "@eo/contracts";
import { mapHttpStatusToConnectorError } from "@eo/gateway";

/**
 * Jira's own provider attribution string — used on every `ConnectorError`
 * this package constructs. Kept as one constant rather than hand-typed at
 * each call site (mirrors this codebase's sole-definition-site
 * convention for cross-cutting literals).
 */
export const JIRA_PROVIDER_NAME = "jira-cloud";

/**
 * Jira Data Center's own provider attribution string — roadmap/19-jira-
 * datacenter-adapter.md's reconciliation of the "jira-cloud"/
 * "jira-datacenter" provider-key split (see `../provider/register-
 * datacenter.ts`'s doc comment for the full rationale): a SEPARATE
 * provider key from `JIRA_PROVIDER_NAME`, sharing the SAME
 * `JiraResourceClient` contract, so a Data Center-originated
 * `ConnectorError`'s `provider` field never misleadingly reads
 * `"jira-cloud"`.
 */
export const JIRA_DATACENTER_PROVIDER_NAME = "jira-datacenter";

/**
 * Maps an HTTP response status from a Jira Cloud REST v3/Agile call to
 * exactly one of P02's 10 canonical `ConnectorError` members — a thin,
 * Jira-attributed call site over `@eo/gateway`'s own
 * `mapHttpStatusToConnectorError` (16 owns the mapping mechanics; this
 * phase never reimplements it, roadmap/18 §Out of scope). `rawBody` is
 * accepted for redaction derivation ONLY — `mapHttpStatusToConnectorError`
 * itself guarantees it never survives into the returned error's public
 * shape (see `ConnectorError`'s own redaction discipline).
 */
export function mapJiraStatusToConnectorErrorKind(
  status: number,
  rawBody: unknown,
): ConnectorError {
  return mapHttpStatusToConnectorError({
    status,
    provider: JIRA_PROVIDER_NAME,
    rawProviderResponse: rawBody,
  });
}

/** Data Center equivalent of `mapJiraStatusToConnectorErrorKind` — identical mapping mechanics, attributed to `JIRA_DATACENTER_PROVIDER_NAME` instead. */
export function mapJiraDatacenterStatusToConnectorErrorKind(
  status: number,
  rawBody: unknown,
): ConnectorError {
  return mapHttpStatusToConnectorError({
    status,
    provider: JIRA_DATACENTER_PROVIDER_NAME,
    rawProviderResponse: rawBody,
  });
}
