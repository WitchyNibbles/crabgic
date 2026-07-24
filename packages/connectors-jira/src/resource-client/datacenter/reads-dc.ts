import type { z } from "zod";
import {
  RawJiraBoardListSchema,
  RawJiraBoardSchema,
  RawJiraCommentListSchema,
  RawJiraIssueSchema,
  RawJiraSprintListSchema,
  RawJiraSprintSchema,
  RawJiraTransitionListSchema,
  RawJiraWorklogListSchema,
} from "../schemas.js";
import type {
  JiraBoard,
  JiraComment,
  JiraIssue,
  JiraIssueSearchResult,
  JiraProject,
  JiraSprint,
  JiraTransition,
  JiraWorklog,
} from "../types.js";
import { collectAllPages, type FetchPage } from "@eo/gateway";
import {
  jiraDatacenterGetJson,
  type JiraDatacenterHttpContext,
} from "./jira-datacenter-http-context.js";
import {
  RawJiraDatacenterIssueSearchSchema,
  RawJiraDatacenterProjectListSchema,
} from "./schemas-dc.js";

/**
 * Data Center REST v2 + Agile read methods — roadmap/19-jira-datacenter-
 * adapter.md §In scope: "REST v2 + Agile routes, implementing the same
 * resource-client contract 18 establishes for Cloud." The Agile API
 * (`/rest/agile/1.0/...`) is IDENTICAL between Cloud and Data Center, so
 * `listBoards`/`getBoard`/`listSprints`/`getSprint` use the exact same
 * paths `../reads.ts` does; only the `/rest/api/2/` (vs. `/rest/api/3/`)
 * prefix and the offset-based issue-search pagination genuinely differ —
 * see `./schemas-dc.ts`'s doc comment.
 */

function toJiraProject(
  raw: z.infer<typeof RawJiraDatacenterProjectListSchema>[number],
): JiraProject {
  return { id: raw.id, key: raw.key, name: raw.name };
}

export async function listProjects(
  ctx: JiraDatacenterHttpContext,
): Promise<readonly JiraProject[]> {
  const raw = await jiraDatacenterGetJson(
    ctx,
    "/rest/api/2/project",
    RawJiraDatacenterProjectListSchema,
    "projects.list",
  );
  return raw.map(toJiraProject);
}

export async function getProject(
  ctx: JiraDatacenterHttpContext,
  projectKeyOrId: string,
): Promise<JiraProject> {
  const raw = await jiraDatacenterGetJson(
    ctx,
    `/rest/api/2/project/${encodeURIComponent(projectKeyOrId)}`,
    RawJiraDatacenterProjectListSchema.element,
    "projects.get",
  );
  return toJiraProject(raw);
}

function toJiraBoard(raw: z.infer<typeof RawJiraBoardSchema>): JiraBoard {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    ...(raw.location?.projectKey !== undefined ? { projectKey: raw.location.projectKey } : {}),
  };
}

export async function listBoards(
  ctx: JiraDatacenterHttpContext,
  projectKeyOrId?: string,
): Promise<readonly JiraBoard[]> {
  const projectFilter =
    projectKeyOrId !== undefined ? `&projectKeyOrId=${encodeURIComponent(projectKeyOrId)}` : "";
  const fetchPage: FetchPage<JiraBoard> = async (cursor) => {
    const startAt = cursor ?? "0";
    const page = await jiraDatacenterGetJson(
      ctx,
      `/rest/agile/1.0/board?startAt=${startAt}&maxResults=50${projectFilter}`,
      RawJiraBoardListSchema,
      "boards.list",
    );
    const items = page.values.map(toJiraBoard);
    const nextCursor = items.length === 50 ? String(Number(startAt) + 50) : undefined;
    return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
  };
  return collectAllPages(fetchPage);
}

export async function getBoard(
  ctx: JiraDatacenterHttpContext,
  boardId: number,
): Promise<JiraBoard> {
  const raw = await jiraDatacenterGetJson(
    ctx,
    `/rest/agile/1.0/board/${boardId}`,
    RawJiraBoardSchema,
    "boards.get",
  );
  return toJiraBoard(raw);
}

function toJiraSprint(raw: z.infer<typeof RawJiraSprintSchema>): JiraSprint {
  return {
    id: raw.id,
    name: raw.name,
    state: raw.state,
    boardId: raw.originBoardId,
    ...(raw.startDate !== undefined ? { startDate: raw.startDate } : {}),
    ...(raw.endDate !== undefined ? { endDate: raw.endDate } : {}),
  };
}

export async function listSprints(
  ctx: JiraDatacenterHttpContext,
  boardId: number,
): Promise<readonly JiraSprint[]> {
  const fetchPage: FetchPage<JiraSprint> = async (cursor) => {
    const startAt = cursor ?? "0";
    const page = await jiraDatacenterGetJson(
      ctx,
      `/rest/agile/1.0/board/${boardId}/sprint?startAt=${startAt}&maxResults=50`,
      RawJiraSprintListSchema,
      "sprints.list",
    );
    const items = page.values.map(toJiraSprint);
    const nextCursor = items.length === 50 ? String(Number(startAt) + 50) : undefined;
    return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
  };
  return collectAllPages(fetchPage);
}

export async function getSprint(
  ctx: JiraDatacenterHttpContext,
  sprintId: number,
): Promise<JiraSprint> {
  const raw = await jiraDatacenterGetJson(
    ctx,
    `/rest/agile/1.0/sprint/${sprintId}`,
    RawJiraSprintSchema,
    "sprints.get",
  );
  return toJiraSprint(raw);
}

function toJiraIssue(raw: z.infer<typeof RawJiraIssueSchema>): JiraIssue {
  const { summary, issuetype, status, updated, ...rest } = raw.fields;
  return {
    id: raw.id,
    key: raw.key,
    summary,
    issueType: issuetype.name,
    status: {
      name: status.name,
      ...(status.statusCategory?.key !== undefined
        ? { statusCategoryKey: status.statusCategory.key }
        : {}),
    },
    revision: updated ?? "unknown",
    fields: rest,
  };
}

/**
 * Data Center's classic `/rest/api/2/search` is offset-based: the caller
 * passes `startAt` (this connector's own `pageToken` convention, unified
 * with `../reads.ts`'s cursor-string param shape even though the
 * underlying protocol differs), and `nextPageToken` is computed from
 * `startAt + issues.length < total` — never from a cursor Data Center
 * doesn't return at all.
 */
export async function searchIssues(
  ctx: JiraDatacenterHttpContext,
  jql: string,
  pageToken?: string,
): Promise<JiraIssueSearchResult> {
  const startAt = pageToken ?? "0";
  const raw = await jiraDatacenterGetJson(
    ctx,
    `/rest/api/2/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=50`,
    RawJiraDatacenterIssueSearchSchema,
    "issues.search",
  );
  const nextOffset = raw.startAt + raw.issues.length;
  return {
    issues: raw.issues.map(toJiraIssue),
    ...(nextOffset < raw.total ? { nextPageToken: String(nextOffset) } : {}),
  };
}

export async function getIssue(
  ctx: JiraDatacenterHttpContext,
  issueKey: string,
): Promise<JiraIssue> {
  const raw = await jiraDatacenterGetJson(
    ctx,
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}`,
    RawJiraIssueSchema,
    "issues.get",
  );
  return toJiraIssue(raw);
}

export async function listTransitions(
  ctx: JiraDatacenterHttpContext,
  issueKey: string,
): Promise<readonly JiraTransition[]> {
  const raw = await jiraDatacenterGetJson(
    ctx,
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`,
    RawJiraTransitionListSchema,
    "issues.transitions",
  );
  return raw.transitions.map((t) => ({
    id: t.id,
    name: t.name,
    toStatusName: t.to.name,
    ...(t.to.statusCategory?.key !== undefined
      ? { toStatusCategoryKey: t.to.statusCategory.key }
      : {}),
  }));
}

export async function listComments(
  ctx: JiraDatacenterHttpContext,
  issueKey: string,
): Promise<readonly JiraComment[]> {
  const raw = await jiraDatacenterGetJson(
    ctx,
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`,
    RawJiraCommentListSchema,
    "comments.list",
  );
  return raw.comments.map((c) => ({
    id: c.id,
    bodyAdf: c.body,
    properties: c.properties ?? {},
    updatedRevision: c.updated ?? "unknown",
  }));
}

export async function listWorklogs(
  ctx: JiraDatacenterHttpContext,
  issueKey: string,
): Promise<readonly JiraWorklog[]> {
  const raw = await jiraDatacenterGetJson(
    ctx,
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}/worklog`,
    RawJiraWorklogListSchema,
    "worklogs.list",
  );
  return raw.worklogs.map((w) => ({
    id: w.id,
    timeSpentSeconds: w.timeSpentSeconds,
    ...(w.comment !== undefined ? { comment: w.comment } : {}),
  }));
}
