/**
 * `JiraWorkflowStage` — roadmap/18-jira-cloud-adapter.md §Interfaces
 * produced: "closed union `planned | in_progress | blocked | done`; the
 * Jira ticket-status projection, populated by the never-guess transition
 * mapper. Distinct token space from P02's run-lifecycle `blocked` terminal
 * — same spelling, unrelated enum, never to be conflated."
 *
 * MEDIUM M3 (adversarial-review) — documented interpretation of "never
 * silently to `done`": that principle is about NEVER GUESSING from a
 * status NAME this connector doesn't recognize (a custom workflow status,
 * a typo, a future Jira renaming a built-in status) — an unrecognized
 * NAME never resolves to `done` on name-matching alone. It is
 * deliberately NOT a mandate to distrust Jira's own `statusCategory.key`
 * field: that field is a fixed, Jira-computed 3-value enum
 * (`new`/`indeterminate`/`done`) a workflow admin selects from Jira's own
 * status-configuration UI — it is not free-form text an attacker can
 * shape, and reading it is not "guessing," it is reading Jira's own
 * authoritative classification of the status. So:
 *
 *  - an EXACT known-name match (`KNOWN_STATUS_NAME_TO_STAGE`) always
 *    wins, regardless of any category hint.
 *  - failing that, an explicit `done` CATEGORY hint is trusted to signal
 *    `done` even for an unrecognized NAME — this is the one place this
 *    mapper resolves an unrecognized name to `done`, and it is
 *    intentional (`workflow-stage.test.ts`'s property suite proves and
 *    documents this case explicitly, rather than silently excluding it
 *    from the "never guess" proof as an earlier revision of this test
 *    did). `../resource-client/jira-resource-client.ts`'s closing-
 *    transition safety gate (HIGH H2, adversarial-review) depends on
 *    this: a real closing transition to a SITE-CUSTOM status name (e.g.
 *    "Ready for Prod") with Jira's own `done` category MUST still be
 *    recognized as closing — trusting only known NAMES would let exactly
 *    that transition bypass the done-evidence gate while still closing
 *    the issue for real on the wire.
 *  - failing THAT, a `new`/`indeterminate` category hint maps to
 *    `planned`/`in_progress` respectively (lower-stakes than `done`, so a
 *    permissive read here carries no comparable safety risk).
 *  - anything else (no category, or a category outside those three keys)
 *    is `"blocked"` — never a silent guess in either direction.
 */

export const JIRA_WORKFLOW_STAGES = ["planned", "in_progress", "blocked", "done"] as const;

export type JiraWorkflowStage = (typeof JIRA_WORKFLOW_STAGES)[number];

export function isJiraWorkflowStage(value: unknown): value is JiraWorkflowStage {
  return typeof value === "string" && (JIRA_WORKFLOW_STAGES as readonly string[]).includes(value);
}

/** Jira's own status-category key, when known (`GET /rest/api/3/status` / a status's embedded `statusCategory.key`). */
export type JiraStatusCategoryKey = "new" | "indeterminate" | "done";

/**
 * Case-insensitive, trimmed lookup table of well-known Jira built-in
 * status names → `JiraWorkflowStage`. Deliberately NOT exhaustive over
 * every custom workflow a Jira site can define — that is exactly the
 * point: anything absent from this table falls through to the
 * status-category fallback, and absent THAT, to `"blocked"`.
 *
 * A `Map`, deliberately NOT a plain object literal (bug found via the
 * M3 property-test broadening below, fast-check counterexample
 * `"__proto__"`): a plain object's `["__proto__"]`/`["constructor"]`/
 * `["toString"]`/etc. lookups resolve to INHERITED `Object.prototype`
 * members — themselves objects/functions, never `undefined` — so a
 * `known !== undefined` guard against a plain object silently returns a
 * non-`JiraWorkflowStage` value for those specific inputs instead of
 * falling through to the never-guess fallback. `Map#get` has no such
 * prototype-chain special-casing for any string key, "__proto__"
 * included.
 */
const KNOWN_STATUS_NAME_TO_STAGE: ReadonlyMap<string, JiraWorkflowStage> = new Map([
  ["to do", "planned"],
  ["open", "planned"],
  ["backlog", "planned"],
  ["selected for development", "planned"],
  ["in progress", "in_progress"],
  ["in review", "in_progress"],
  ["in development", "in_progress"],
  ["reopened", "in_progress"],
  ["done", "done"],
  ["closed", "done"],
  ["resolved", "done"],
]);

function normalizeStatusName(statusName: string): string {
  return statusName.trim().toLowerCase();
}

/**
 * Never-guess mapper: exact known-name match wins; otherwise a `done`
 * status-category hint maps to `done`, a `new` hint maps to `planned`, an
 * `indeterminate` hint maps to `in_progress`; anything else (no hint, or a
 * hint outside those three keys) is `"blocked"` — never a silent `"done"`.
 */
export function mapJiraStatusToWorkflowStage(
  statusName: string,
  statusCategoryKey?: JiraStatusCategoryKey,
): JiraWorkflowStage {
  const normalized = normalizeStatusName(statusName);
  const known = KNOWN_STATUS_NAME_TO_STAGE.get(normalized);
  if (known !== undefined) {
    return known;
  }

  switch (statusCategoryKey) {
    case "done":
      return "done";
    case "new":
      return "planned";
    case "indeterminate":
      return "in_progress";
    default:
      return "blocked";
  }
}
