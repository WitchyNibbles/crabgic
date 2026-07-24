import { ConnectorError } from "@eo/contracts";
import { isJiraAction } from "../resource-client/actions.js";

/**
 * Pre-flight capability guard — roadmap/18 §Test plan, Security bullet:
 * "forged delete/admin/impersonation/raw-endpoint calls fail before any
 * network I/O (pre-flight capability check, never a server-side 403 as
 * the sole guard)." Every entry point that plans or applies a Jira
 * mutation calls this FIRST, synchronously, before constructing any HTTP
 * request or touching a transport — a candidate action outside
 * `JIRA_ACTIONS` (`../resource-client/actions.ts`'s closed union) throws
 * `ConnectorError.policyBlocked` immediately.
 *
 * This is intentionally a closed-allowlist check, not a denylist of known-
 * bad patterns: `isJiraAction` only recognizes the exact 17 members of
 * `JIRA_ACTIONS`, so ANY string outside that set — a delete, an admin
 * action, an impersonation attempt, a raw-endpoint escape hatch, or
 * gibberish — is refused by construction, never by pattern-matching
 * against attacker-guessable denylist entries.
 */
export function assertAllowedJiraOperation(action: string): void {
  if (!isJiraAction(action)) {
    throw ConnectorError.policyBlocked({
      message: "requested Jira operation is outside the allowed action set",
      provider: "jira-cloud",
      retryable: false,
    });
  }
}
