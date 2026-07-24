import { z } from "zod";
import { collectAllPages, type FetchPage } from "@eo/gateway";
import { jiraGetJson, type JiraHttpContext } from "./http-read-helper.js";
import {
  RawJiraBoardListSchema,
  RawJiraBoardSchema,
  RawJiraCommentListSchema,
  RawJiraIssueSchema,
  RawJiraIssueSearchSchema,
  RawJiraProjectSchema,
  RawJiraProjectSearchSchema,
  RawJiraSprintListSchema,
  RawJiraSprintSchema,
  RawJiraTransitionListSchema,
  RawJiraWorklogListSchema,
} from "./schemas.js";
import type {
  JiraBoard,
  JiraComment,
  JiraIssue,
  JiraIssueSearchResult,
  JiraProject,
  JiraSprint,
  JiraTransition,
  JiraWorklog,
} from "./types.js";

/** Every read method here is a thin GET + boundary-validate + project-into-domain-shape call, built on `jiraGetJson` (never a bespoke fetch). */

function toJiraProject(raw: z.infer<typeof RawJiraProjectSchema>): JiraProject {
  return { id: raw.id, key: raw.key, name: raw.name };
}

export async function listProjects(ctx: JiraHttpContext): Promise<readonly JiraProject[]> {
  const fetchPage: FetchPage<JiraProject> = async (cursor) => {
    const startAt = cursor ?? "0";
    const page = await jiraGetJson(
      ctx,
      `/rest/api/3/project/search?startAt=${startAt}&maxResults=50`,
      RawJiraProjectSearchSchema,
      "projects.list",
    );
    const items = page.values.map(toJiraProject);
    const nextCursor = items.length === 50 ? String(Number(startAt) + 50) : undefined;
    return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
  };
  return collectAllPages(fetchPage);
}

export async function getProject(
  ctx: JiraHttpContext,
  projectKeyOrId: string,
): Promise<JiraProject> {
  const raw = await jiraGetJson(
    ctx,
    `/rest/api/3/project/${encodeURIComponent(projectKeyOrId)}`,
    RawJiraProjectSchema,
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
  ctx: JiraHttpContext,
  projectKeyOrId?: string,
): Promise<readonly JiraBoard[]> {
  const projectFilter =
    projectKeyOrId !== undefined ? `&projectKeyOrId=${encodeURIComponent(projectKeyOrId)}` : "";
  const fetchPage: FetchPage<JiraBoard> = async (cursor) => {
    const startAt = cursor ?? "0";
    const page = await jiraGetJson(
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

export async function getBoard(ctx: JiraHttpContext, boardId: number): Promise<JiraBoard> {
  const raw = await jiraGetJson(
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
  ctx: JiraHttpContext,
  boardId: number,
): Promise<readonly JiraSprint[]> {
  const fetchPage: FetchPage<JiraSprint> = async (cursor) => {
    const startAt = cursor ?? "0";
    const page = await jiraGetJson(
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

export async function getSprint(ctx: JiraHttpContext, sprintId: number): Promise<JiraSprint> {
  const raw = await jiraGetJson(
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

export async function searchIssues(
  ctx: JiraHttpContext,
  jql: string,
  pageToken?: string,
): Promise<JiraIssueSearchResult> {
  const tokenParam =
    pageToken !== undefined ? `&nextPageToken=${encodeURIComponent(pageToken)}` : "";
  const raw = await jiraGetJson(
    ctx,
    `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}${tokenParam}`,
    RawJiraIssueSearchSchema,
    "issues.search",
  );
  return {
    issues: raw.issues.map(toJiraIssue),
    ...(raw.nextPageToken !== undefined ? { nextPageToken: raw.nextPageToken } : {}),
  };
}

export async function getIssue(ctx: JiraHttpContext, issueKey: string): Promise<JiraIssue> {
  const raw = await jiraGetJson(
    ctx,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
    RawJiraIssueSchema,
    "issues.get",
  );
  return toJiraIssue(raw);
}

export async function listTransitions(
  ctx: JiraHttpContext,
  issueKey: string,
): Promise<readonly JiraTransition[]> {
  const raw = await jiraGetJson(
    ctx,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
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
  ctx: JiraHttpContext,
  issueKey: string,
): Promise<readonly JiraComment[]> {
  const raw = await jiraGetJson(
    ctx,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
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
  ctx: JiraHttpContext,
  issueKey: string,
): Promise<readonly JiraWorklog[]> {
  const raw = await jiraGetJson(
    ctx,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`,
    RawJiraWorklogListSchema,
    "worklogs.list",
  );
  return raw.worklogs.map((w) => ({
    id: w.id,
    timeSpentSeconds: w.timeSpentSeconds,
    ...(w.comment !== undefined ? { comment: w.comment } : {}),
  }));
}
