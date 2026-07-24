import { z } from "zod";

/**
 * Boundary-validation zod schemas for Jira Cloud REST v3/Agile response
 * shapes — roadmap/18 RULES: "Validate all external API responses at the
 * boundary (never trust Jira's response shape)." Every `./reads.ts`
 * method parses the raw JSON body through exactly one of these before
 * constructing its typed domain return value; a shape violation is a
 * `validation`-kind `ConnectorError`, never a silently-coerced/partial
 * object.
 */

export const JiraStatusCategoryKeySchema = z.enum(["new", "indeterminate", "done"]);

export const RawJiraProjectSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
});

export const RawJiraProjectSearchSchema = z.object({
  values: z.array(RawJiraProjectSchema),
});

export const RawJiraBoardSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string(),
  location: z.object({ projectKey: z.string().optional() }).optional(),
});

export const RawJiraBoardListSchema = z.object({
  values: z.array(RawJiraBoardSchema),
});

export const RawJiraSprintSchema = z.object({
  id: z.number(),
  name: z.string(),
  state: z.enum(["future", "active", "closed"]),
  originBoardId: z.number(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const RawJiraSprintListSchema = z.object({
  values: z.array(RawJiraSprintSchema),
});

export const RawJiraIssueStatusSchema = z.object({
  name: z.string(),
  statusCategory: z.object({ key: JiraStatusCategoryKeySchema }).optional(),
});

export const RawJiraIssueSchema = z.object({
  id: z.string(),
  key: z.string(),
  fields: z
    .object({
      summary: z.string(),
      issuetype: z.object({ name: z.string() }),
      status: RawJiraIssueStatusSchema,
      updated: z.string().optional(),
    })
    .passthrough(),
});

export const RawJiraIssueSearchSchema = z.object({
  issues: z.array(RawJiraIssueSchema),
  nextPageToken: z.string().optional(),
});

export const RawJiraTransitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  to: z.object({
    name: z.string(),
    statusCategory: z.object({ key: JiraStatusCategoryKeySchema }).optional(),
  }),
});

export const RawJiraTransitionListSchema = z.object({
  transitions: z.array(RawJiraTransitionSchema),
});

export const RawJiraCommentSchema = z.object({
  id: z.string(),
  body: z.unknown(),
  properties: z.record(z.string(), z.unknown()).optional(),
  updated: z.string().optional(),
});

export const RawJiraCommentListSchema = z.object({
  comments: z.array(RawJiraCommentSchema),
});

export const RawJiraWorklogSchema = z.object({
  id: z.string(),
  timeSpentSeconds: z.number(),
  comment: z.unknown().optional(),
});

export const RawJiraWorklogListSchema = z.object({
  worklogs: z.array(RawJiraWorklogSchema),
});

export const RawJiraFieldMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  custom: z.boolean(),
  schema: z.object({ type: z.string() }).optional(),
});

export const RawJiraFieldMetadataListSchema = z.array(RawJiraFieldMetadataSchema);
