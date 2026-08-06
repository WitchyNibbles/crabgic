/**
 * Canonical-target helpers — `RemoteMutationPlan.canonicalTarget` is "an
 * opaque, provider-agnostic identifier for the resource this plan acts
 * on" (P02 doc comment). This connector's own convention (kept internal —
 * no other phase parses these strings): `<resourceKind>:<id>`.
 *
 * `writeSerializationTarget` below is this package's second, deliberate
 * parse site (alongside the two apply clients' own `split(":")`): it
 * derives the SERIALIZATION key from the identity key, which is why the
 * per-kind shapes here are safe to keep distinct.
 */
export function issueTarget(issueKey: string): string {
  return `issue:${issueKey}`;
}

export function boardTarget(boardId: number): string {
  return `board:${boardId}`;
}

export function sprintTarget(sprintId: number): string {
  return `sprint:${sprintId}`;
}

export function commentTarget(issueKey: string, commentId?: string): string {
  return commentId !== undefined
    ? `issue:${issueKey}:comment:${commentId}`
    : `issue:${issueKey}:comment`;
}

export function worklogTarget(issueKey: string): string {
  return `issue:${issueKey}:worklog`;
}

export function attachmentTarget(issueKey: string): string {
  return `issue:${issueKey}:attachment`;
}

const ISSUE_TARGET_PREFIX = "issue:";
const BULK_TARGET_PREFIX = "bulk:";

/**
 * Derives the WRITE-SERIALIZATION key for a plan's canonical target —
 * roadmap/18 §Exit criteria 10, second clause: "per-issue write order
 * preserved," grounded by §In scope's "per-issue write compliance …
 * cross-worker throttling via 16's gateway-side serialization."
 *
 * Every issue-scoped shape this module mints (`issue:K`,
 * `issue:K:comment`, `issue:K:comment:<id>`, `issue:K:worklog`,
 * `issue:K:attachment`) collapses onto ONE key, `issue:K`, so 16's
 * per-tenant+resource write mutex (`@crabgic/gateway`'s
 * `WriteSerializer`) actually serializes a field update, a comment, a
 * worklog and an attachment upload against each other on the same issue
 * — which is exactly the budget Jira's per-issue write rate limit
 * governs. The criterion is unqualified, so no kind is carved out.
 *
 * Identity is NOT collapsed. `canonicalTarget` remains the marker-
 * reconciliation and audit identifier, and both apply clients parse a
 * `commentId` back out of it (`./jira-mutation-apply-client.ts:199`,
 * `./datacenter/jira-mutation-apply-client-dc.ts:194`). This function is
 * the serialization key only, surfaced to the pipeline through
 * `MutationApplyClient.serializationTarget`.
 *
 * `bulk:<key>,<key>,…` (`./issue-plans.ts:189`, `:210` —
 * `issue.bulkUpdate`/`issue.bulkTransition`) IS a write to existing,
 * named issues, and the keys are right there in the target, so it maps
 * onto the SET of its member issues' keys — `["issue:PROJ-1",
 * "issue:PROJ-2"]`. That set is what 16's
 * `WriteSerializer.runExclusiveMulti` acquires at once
 * (`packages/gateway/src/transport/write-serializer.ts`), so a bulk
 * write serializes against a single-issue write to ANY member. Until
 * that primitive existed a mutex key was necessarily a single string —
 * no key could mean "all of PROJ-1 and PROJ-2 at once" and folding a
 * bulk plan onto any ONE of its issues would have been wrong — so this
 * target passed through unchanged and the gap was pinned as a residual
 * in `./canonical-target.test.ts`. It no longer is.
 *
 * THE SET IS SORTED AND DEDUPED, and that is not cosmetic:
 * `issue.bulkUpdate(["PROJ-2","PROJ-1"])` mints a DIFFERENT
 * `canonicalTarget` from `["PROJ-1","PROJ-2"]`, so without a canonical
 * key ORDER two bulk plans over the same issues would still fail to
 * serialize against each other. (16's `runExclusiveMulti` canonicalizes
 * again on its own side; the duplication is deliberate — this module's
 * contract is testable here, in the package that owns the parse, rather
 * than only through the gateway.)
 *
 * A `bulk:` target naming no issue at all (`bulk:`, `bulk:,,`) is
 * returned UNCHANGED rather than as an empty set: a write is never left
 * without a serialization key, and answering here keeps the decision in
 * this module instead of leaning on the pipeline's own fallback.
 *
 * Every other shape is returned UNCHANGED because it is not an
 * issue-scoped write: board/sprint targets (`board:<id>`,
 * `sprint:<id>`) and the create-shaped targets that name no existing
 * issue (`project:<key>:new-issue`, `project:<key>:new-board`,
 * `board:<id>:new-sprint`).
 *
 * RESIDUAL, narrowed but not gone — cross-issue parallelism between
 * single-issue writes is untouched, as intended, and a bulk plan and a
 * single write to a NON-member issue still run concurrently (pinned as
 * the `=== 2` controls in `../testkit/write-order.integration.test.ts`).
 */
export function writeSerializationTarget(canonicalTarget: string): string | readonly string[] {
  if (canonicalTarget.startsWith(BULK_TARGET_PREFIX)) {
    const memberKeys = canonicalTarget.slice(BULK_TARGET_PREFIX.length).split(",");
    const distinct = [
      ...new Set(memberKeys.filter((key) => key.length > 0).map((key) => issueTarget(key))),
    ].sort();
    // Names no issue ⇒ nothing to derive; keep the write keyed on its
    // own identity rather than returning an empty set.
    return distinct.length > 0 ? distinct : canonicalTarget;
  }
  if (!canonicalTarget.startsWith(ISSUE_TARGET_PREFIX)) return canonicalTarget;
  const parts = canonicalTarget.split(":");
  const issueKey = parts[1];
  if (issueKey === undefined || issueKey.length === 0) return canonicalTarget;
  return `${ISSUE_TARGET_PREFIX}${issueKey}`;
}
