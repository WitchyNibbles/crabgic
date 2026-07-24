import type { MarkerReconciler } from "@eo/gateway";
import { listComments, searchIssues } from "../resource-client/datacenter/reads-dc.js";
import type { JiraDatacenterHttpContext } from "../resource-client/datacenter/jira-datacenter-http-context.js";
import type { JiraMarkerKind } from "./entity-property-marker.js";

/**
 * Data Center equivalent of `./entity-property-marker.ts` — roadmap/19-
 * jira-datacenter-adapter.md §In scope: "Same resource/prohibition/
 * high-impact-capability matrix as 18 ... reused verbatim." The marker-
 * reconciliation STRATEGY (entity-property JQL search; zero/ambiguous
 * matches both resolve to "genuinely unknown," never a guessed
 * duplicate) is identical to Cloud's — only the underlying read calls
 * differ (`../resource-client/datacenter/reads-dc.ts`'s REST v2 `search`/
 * `comment` endpoints, not Cloud's REST v3 ones), so this is a thin,
 * separate module rather than a fork of the reconciliation LOGIC itself.
 */
export function createJiraDatacenterEntityPropertyMarkerReconciler(
  ctx: JiraDatacenterHttpContext,
  kind: JiraMarkerKind,
  issueKeyForComments?: string,
): MarkerReconciler {
  return {
    findByMarker: async (marker: string): Promise<string | undefined> => {
      try {
        if (kind === "issue") {
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
        return undefined;
      }
    },
  };
}
