import { z } from "zod";
import { RawJiraIssueSchema, RawJiraProjectSchema } from "../schemas.js";

/**
 * Data Center's classic `GET /rest/api/2/project` returns a bare JSON
 * array of projects directly — unlike Cloud's paginated
 * `GET /rest/api/3/project/search`, which wraps its page in
 * `{values:[...]}`. Same per-project shape either way, so
 * `RawJiraProjectSchema` (`../schemas.ts`) is reused unchanged for each
 * array element.
 */
export const RawJiraDatacenterProjectListSchema = z.array(RawJiraProjectSchema);

/**
 * Data Center-only boundary-validation schemas — everything else this
 * connector reads (project/board/sprint/issue/transition/comment/worklog
 * shapes) is BYTE-IDENTICAL JSON between Jira Cloud REST v3 and Data
 * Center REST v2/Agile, so `../schemas.ts`'s existing schemas are reused
 * verbatim (see `./reads-dc.ts`). The ONE genuine shape difference is
 * search pagination: Cloud's `/rest/api/3/search/jql` is cursor-based
 * (`nextPageToken`); Data Center's classic `/rest/api/2/search` is
 * offset-based (`startAt`/`maxResults`/`total`, no cursor token at all).
 */
export const RawJiraDatacenterIssueSearchSchema = z.object({
  issues: z.array(RawJiraIssueSchema),
  startAt: z.number(),
  maxResults: z.number(),
  total: z.number(),
});
