import type { MarkerReconciler } from "@eo/gateway";
import { listComments, searchIssues } from "../resource-client/reads.js";
import type { JiraHttpContext } from "../resource-client/http-read-helper.js";

/**
 * Jira entity-property `MarkerReconciler` — roadmap/18 §In scope:
 * "Reconciliation: implements 16's marker-reconciliation interface using
 * Jira entity properties as the exactly-once marker for every POST
 * (issue/comment creation)." `@eo/gateway` declares the interface only
 * (`reconciliation.ts`); this module is the Jira-specific implementation
 * roadmap/18 names.
 *
 * Every marker-creating write (`comment.create`/`issue.create`) stamps a
 * deterministic entity property (keyed `marker`, valued the plan's own
 * idempotency key or a caller-supplied token) at create time — after a
 * mid-POST timeout, `findByMarker` searches for that property to
 * determine whether the write already landed. Deliberately never guesses:
 * zero matches, MORE THAN ONE match (a genuinely ambiguous state this
 * connector refuses to arbitrarily pick from), or any transport/parse
 * failure all resolve to `undefined` — "genuinely unknown," never a
 * guessed duplicate (mirrors `@eo/gateway`'s own `reconcileAmbiguousPost`
 * doc comment).
 */
export type JiraMarkerKind = "issue" | "comment";

export function createJiraEntityPropertyMarkerReconciler(
  ctx: JiraHttpContext,
  kind: JiraMarkerKind,
  issueKeyForComments?: string,
): MarkerReconciler {
  return {
    findByMarker: async (marker: string): Promise<string | undefined> => {
      try {
        if (kind === "issue") {
          // Jira's indexed entity-property JQL clause searches issues
          // carrying a given entity-property value without this connector
          // maintaining its own separate index.
          const jql = `issue.property[eo].marker = "${marker.replace(/"/g, '\\"')}"`;
          const result = await searchIssues(ctx, jql);
          return result.issues.length === 1 ? result.issues[0]?.key : undefined;
        }

        if (issueKeyForComments === undefined) {
          return undefined;
        }
        const comments = await listComments(ctx, issueKeyForComments);
        const matches = comments.filter((c) => c.properties["marker"] === marker);
        return matches.length === 1 ? matches[0]?.id : undefined;
      } catch {
        // A transport/parse failure during reconciliation is itself
        // "genuinely unknown" — never surfaced as a thrown error here,
        // and never interpreted as "found."
        return undefined;
      }
    },
  };
}
