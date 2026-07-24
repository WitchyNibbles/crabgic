import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import {
  IdempotencyKeyLock,
  executeMutationPlan,
  preconditionFailedResponse,
  type FakeProviderScriptEntry,
} from "@eo/gateway";
import { toADF } from "@eo/renderer";
import type { JiraDeploymentType } from "../provider/jira-connection-config.js";
import { buildConformanceHarness } from "./conformance-harness.js";

/**
 * roadmap/19-jira-datacenter-adapter.md work item 5 (Failing test first:
 * "invoking the suite with a `datacenter` parameter value fails ...
 * before the refactor; after, `cloud` and `datacenter` pass identical
 * assertions") + §Exit criteria: "Parameterized conformance suite green
 * on both `cloud` and `datacenter` (10.3 and 11.3) fixture-backed runs."
 *
 * ONE suite, `describe.each`-parameterized over `JiraDeploymentType`,
 * running the IDENTICAL assertions 18's `jira-flow.integration.test.ts`
 * established for Cloud (board → sprint → epic → issue → link → comment
 * → worklog → attachment; a transition with server-resolved done-ness;
 * a 412 concurrent-edit conflict) against BOTH deployment types, via
 * `./conformance-harness.ts`'s parameterized factory — never a forked
 * second suite, never deployment-type-specific assertions.
 */
const ENVELOPE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BASE_URL_BY_DEPLOYMENT: Record<JiraDeploymentType, string> = {
  cloud: "https://parameterized-conformance-cloud.invalid",
  datacenter: "https://parameterized-conformance-dc.invalid",
};

function ok(body: unknown): FakeProviderScriptEntry {
  return { status: 201, bodyText: JSON.stringify(body) };
}

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-connectors-jira-parameterized-"));
  journal = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe.each(["cloud", "datacenter"] as const satisfies readonly JiraDeploymentType[])(
  "parameterized Jira conformance suite — deploymentType=%s",
  (deploymentType) => {
    it("board → sprint → epic → issue → link → comment(rich text) → worklog → attachment applies through the real mutation pipeline and records successfully", async () => {
      const harness = buildConformanceHarness(
        deploymentType,
        [
          ok({ id: 1, name: "Sprint Board", type: "scrum" }), // board.create
          ok({ id: 10, name: "Sprint 1", state: "future", originBoardId: 1 }), // sprint.create
          ok({ id: "20001", key: "PROJ-1" }), // epic issue.create
          ok({ id: "20002", key: "PROJ-2" }), // story issue.create
          { status: 201, bodyText: "" }, // issue.link
          ok({ id: "50001" }), // comment.create
          ok({ id: "30001" }), // worklog.create
          { status: 200, bodyText: JSON.stringify([{ id: "40001" }]) }, // attachment.upload
        ],
        BASE_URL_BY_DEPLOYMENT[deploymentType],
      );
      const apply = (plan: Parameters<typeof executeMutationPlan>[0]) =>
        executeMutationPlan(
          plan,
          {
            provider: harness.provider,
            buildRequest: (p) => harness.applyClient.buildRequest(p),
            parseResponse: (p, r) => harness.applyClient.parseResponse(p, r),
            verify: (p, a) => harness.applyClient.verify?.(p, a) ?? Promise.resolve(true),
          },
          { journal, httpClient: harness.httpClient, lock: new IdempotencyKeyLock() },
        );

      const boardPlan = harness.resourceClient.boards.planCreate(
        { name: "Sprint Board", type: "scrum", projectKeyOrId: "PROJ" },
        ENVELOPE_ID,
      );
      expect((await apply(boardPlan)).status).toBe("recorded");

      const sprintPlan = harness.resourceClient.sprints.planCreate(
        { boardId: 1, name: "Sprint 1" },
        ENVELOPE_ID,
      );
      expect((await apply(sprintPlan)).status).toBe("recorded");

      const epicPlan = harness.resourceClient.issues.planCreate(
        { projectKeyOrId: "PROJ", issueType: "Epic", summaryAdf: toADF("Epic summary") },
        ENVELOPE_ID,
      );
      const epicOutcome = await apply(epicPlan);
      expect(epicOutcome.status).toBe("recorded");
      expect(epicOutcome.appliedRevision).toBe("PROJ-1");

      const issuePlan = harness.resourceClient.issues.planCreate(
        { projectKeyOrId: "PROJ", issueType: "Story", summaryAdf: toADF("Story summary") },
        ENVELOPE_ID,
      );
      const issueOutcome = await apply(issuePlan);
      expect(issueOutcome.status).toBe("recorded");
      expect(issueOutcome.appliedRevision).toBe("PROJ-2");

      const linkPlan = harness.resourceClient.issues.planLink(
        { linkType: "is child of", outwardIssueKey: "PROJ-2", inwardIssueKey: "PROJ-1" },
        ENVELOPE_ID,
      );
      expect((await apply(linkPlan)).status).toBe("recorded");

      const commentPlan = harness.resourceClient.comments.planCreate(
        "PROJ-2",
        toADF("Outcome: **linked** the story to its epic."),
        "flow-marker-1",
        ENVELOPE_ID,
      );
      const commentOutcome = await apply(commentPlan);
      expect(commentOutcome.status).toBe("recorded");
      expect(commentOutcome.appliedRevision).toBe("50001");

      const worklogPlan = harness.resourceClient.worklogs.planCreate(
        "PROJ-2",
        { timeSpentSeconds: 3600 },
        ENVELOPE_ID,
      );
      expect((await apply(worklogPlan)).appliedRevision).toBe("30001");

      const stagingId = harness.attachmentStaging.stage({
        filename: "log.txt",
        mimeType: "text/plain",
        content: Buffer.from("attachment bytes"),
      });
      const attachmentPlan = harness.resourceClient.attachments.planUpload(
        "PROJ-2",
        { stagingId, filename: "log.txt", sizeBytes: 17 },
        ENVELOPE_ID,
      );
      const attachmentOutcome = await apply(attachmentPlan);
      expect(attachmentOutcome.status).toBe("recorded");
      expect(attachmentOutcome.appliedRevision).toBe("40001");
    });

    it("issue.transition resolves the target status server-side and applies successfully", async () => {
      const harness = buildConformanceHarness(
        deploymentType,
        [
          ok({
            transitions: [
              { id: "31", name: "Close", to: { name: "Done", statusCategory: { key: "done" } } },
            ],
          }),
          { status: 204, bodyText: "" },
          ok({
            id: "1",
            key: "PROJ-2",
            fields: {
              summary: "s",
              issuetype: { name: "Story" },
              status: { name: "Done", statusCategory: { key: "done" } },
              updated: "rev-after-transition",
            },
          }),
        ],
        BASE_URL_BY_DEPLOYMENT[deploymentType],
      );

      const plan = await harness.resourceClient.issues.planTransition(
        "PROJ-2",
        "rev-before-transition",
        "31",
        ENVELOPE_ID,
        true,
      );
      const outcome = await executeMutationPlan(
        plan,
        {
          provider: harness.provider,
          buildRequest: (p) => harness.applyClient.buildRequest(p),
          parseResponse: (p, r) => harness.applyClient.parseResponse(p, r),
          verify: (p, a) => harness.applyClient.verify?.(p, a) ?? Promise.resolve(true),
        },
        { journal, httpClient: harness.httpClient, lock: new IdempotencyKeyLock() },
      );
      expect(outcome.status).toBe("recorded");
    });

    it("a 412 precondition-failed response on issue.update fails as a typed conflict, never a silent overwrite", async () => {
      const harness = buildConformanceHarness(
        deploymentType,
        [preconditionFailedResponse()],
        BASE_URL_BY_DEPLOYMENT[deploymentType],
      );

      const plan = harness.resourceClient.issues.planUpdate(
        "PROJ-2",
        "stale-revision",
        { summary: "an edit based on stale data" },
        ENVELOPE_ID,
      );
      const outcome = await executeMutationPlan(
        plan,
        {
          provider: harness.provider,
          buildRequest: (p) => harness.applyClient.buildRequest(p),
          parseResponse: (p, r) => harness.applyClient.parseResponse(p, r),
          verify: (p, a) => harness.applyClient.verify?.(p, a) ?? Promise.resolve(true),
        },
        { journal, httpClient: harness.httpClient, lock: new IdempotencyKeyLock() },
      );
      expect(outcome.status).toBe("failed");
      expect(outcome.errorKind).toBe("conflict");
    });
  },
);
