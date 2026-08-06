import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import {
  GatewayHttpClient,
  IdempotencyKeyLock,
  createFakeProviderTransport,
  executeMutationPlan,
  preconditionFailedResponse,
  type FakeProviderScriptEntry,
  type HttpTransportRequest,
  type HttpTransportResponse,
} from "@crabgic/gateway";
import { toADF } from "@crabgic/renderer";
import { buildExternalConnection } from "@crabgic/testkit";
import { JiraTokenManager } from "../auth/token-manager.js";
import { AttachmentStagingRegistry } from "../attachments/attachment-staging.js";
import { buildFieldMetadataIndex } from "../capability/field-metadata.js";
import { createJiraMutationApplyClient } from "../resource-client/jira-mutation-apply-client.js";
import { createJiraResourceClient } from "../resource-client/jira-resource-client.js";
import { JiraPlanPayloadRegistry } from "../resource-client/plan-payload-registry.js";
import type { JiraHttpContext } from "../resource-client/http-read-helper.js";
import {
  createCassetteReplayTransport,
  loadWriteScenarioCassette,
  recomputeBodyDigest,
  type WriteScenarioSection,
} from "./write-scenario-cassette.js";

/**
 * roadmap/18 §Exit criteria: "Plan's Jira flow passes on fakes +
 * cassettes: board → sprint → epic → issue → link → worklog →
 * attachment; ADF/text conversion; transitions; concurrent-edit
 * conflicts." This is the one test that chains multiple REAL
 * `executeMutationPlan` calls (never buildRequest/parseResponse tested
 * in isolation) against a REAL, temp-dir-backed journal — proving the
 * full plan → apply → verify → record pipeline for the exact resource
 * chain roadmap/18 names.
 *
 * BOTH fixture regimes the criterion names conjunctively are run here,
 * over the SAME assertions, by `describe.each(["fake", "cassette"])`:
 *
 *  - **fake** — the response script is the inline literal array below,
 *    served positionally by 16's `createFakeProviderTransport`. This is
 *    what the suite did before 2026-08-06 and every assertion is
 *    unchanged.
 *  - **cassette** — the response bytes come from the committed fixture
 *    `./fixtures/write-scenario.cassette.json` and nothing else, served
 *    by `./write-scenario-cassette.ts`'s replay transport, which ALSO
 *    checks each outbound request against the recorded request line and
 *    each served body against its recorded sha-256 digest. The fake arm
 *    has no request-side or byte-level check at all, so the cassette arm
 *    is strictly the stronger of the two on wire shape.
 *
 * ⚠️ HONESTY (the same disclosure `./fake-cassette-parity-dc.test.ts:16-22`
 * carries for Data Center and `e2e/attestation/src/traceabilityEvidence.ts`
 * carries for Grafana): **the write-scenario cassette is HAND-AUTHORED,
 * not captured from a real Jira Cloud instance.** No licensed Cloud
 * sandbox was available. So the cassette arm evidences that this flow
 * replays from a committed on-disk fixture with request/byte-level
 * checking — it does NOT evidence that the recorded shapes are what
 * Atlassian actually returns, and it is NOT evidence for this phase's
 * separate fake/cassette PARITY criterion (`roadmap/18-jira-cloud-adapter.md`,
 * exit criterion 9), which needs a recording independent of the fake.
 * That box stays unticked and owner-gated.
 */
const BASE_URL = "https://flow-test.atlassian.invalid";
const ENVELOPE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function ok(body: unknown): FakeProviderScriptEntry {
  return { status: 201, bodyText: JSON.stringify(body) };
}

/**
 * The inline response scripts — the "fake" arm's source, one per section
 * of the cassette. Kept as literals (the cassette is not derived from
 * them at runtime, nor they from it) so the two arms read two separately
 * maintained files; see the honesty note above for what that does and
 * does not amount to.
 */
const INLINE_SCRIPTS: Readonly<Record<WriteScenarioSection, readonly FakeProviderScriptEntry[]>> = {
  chain: [
    ok({ id: 1, name: "Sprint Board", type: "scrum" }), // board.create
    ok({ id: 10, name: "Sprint 1", state: "future", originBoardId: 1 }), // sprint.create
    ok({ id: "20001", key: "PROJ-1" }), // epic issue.create
    ok({ id: "20002", key: "PROJ-2" }), // story issue.create
    { status: 201, bodyText: "" }, // issue.link (Jira returns 201 empty)
    ok({ id: "50001" }), // comment.create (ADF round trip)
    ok({ id: "30001" }), // worklog.create
    { status: 200, bodyText: JSON.stringify([{ id: "40001" }]) }, // attachment.upload
  ],
  transition: [
    // planTransition's own server-side done-ness resolution (HIGH H2 fix):
    ok({
      transitions: [
        { id: "31", name: "Close", to: { name: "Done", statusCategory: { key: "done" } } },
      ],
    }),
    { status: 204, bodyText: "" }, // issue.transition apply
    // verify()'s read-back GET:
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
  conflict: [preconditionFailedResponse()],
};

type FixtureRegime = "fake" | "cassette";

interface RegimeTransport {
  readonly send: (request: HttpTransportRequest) => Promise<HttpTransportResponse>;
  /** Run after the flow: asserts the regime's own integrity conditions. */
  readonly settle: (expectedCalls: number) => void;
}

/**
 * Opens the response source for one (regime, section) pair. This is the
 * ONLY thing that differs between the two arms — every flow assertion
 * below is shared.
 */
function openTransport(regime: FixtureRegime, section: WriteScenarioSection): RegimeTransport {
  if (regime === "fake") {
    const fake = createFakeProviderTransport({ responses: INLINE_SCRIPTS[section] });
    return {
      send: fake.send,
      settle: (expectedCalls) => {
        expect(fake.calls).toHaveLength(expectedCalls);
      },
    };
  }
  const replay = createCassetteReplayTransport(loadWriteScenarioCassette(), section);
  return {
    send: replay.send,
    settle: (expectedCalls) => {
      // WIRE-SHAPE-SENSITIVE ASSERTION. `violations` is non-empty if any
      // outbound request's method/path disagreed with the recorded request
      // line, or if any served body's sha-256 disagreed with the digest
      // recorded beside it. The flow assertions above are SEMANTIC — they
      // parse the JSON and survive a byte-level key reorder inside a
      // `bodyText`; this one does not. That asymmetry is measured in
      // `docs/evidence/phase-18/cassette-flow-replay-batchJ.txt` §P1.
      expect(replay.violations).toEqual([]);
      expect(replay.entriesServed).toBe(expectedCalls);
    },
  };
}

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-connectors-jira-flow-"));
  journal = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function buildCtx(
  send: (request: HttpTransportRequest) => Promise<HttpTransportResponse>,
): JiraHttpContext {
  const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.100"],
    sendRequest: send,
    sleep: async () => undefined,
  });
  const tokenManager = new JiraTokenManager({
    fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
  });
  return { connection, httpClient, tokenManager };
}

describe.each(["fake", "cassette"] as const)("Jira flow — %s fixture regime", (regime) => {
  describe("board → sprint → epic → issue → link → comment(ADF) → worklog → attachment", () => {
    it("every step in the chain applies through the real mutation pipeline and records successfully", async () => {
      const transport = openTransport(regime, "chain");
      const ctx = buildCtx(transport.send);
      const payloadRegistry = new JiraPlanPayloadRegistry();
      const attachmentStaging = new AttachmentStagingRegistry();
      const resourceClient = createJiraResourceClient({
        ctx,
        fieldMetadataIndex: buildFieldMetadataIndex([]),
        payloadRegistry,
      });
      const applyClient = createJiraMutationApplyClient({
        ctx,
        payloadRegistry,
        attachmentStaging,
        issueMarkerReconciler: { findByMarker: async () => undefined },
        commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
      });
      const lock = new IdempotencyKeyLock();
      const apply = (plan: Parameters<typeof executeMutationPlan>[0]) =>
        executeMutationPlan(
          plan,
          {
            provider: "jira-cloud",
            buildRequest: (p) => applyClient.buildRequest(p),
            parseResponse: (p, r) => applyClient.parseResponse(p, r),
            verify: (p, a) => applyClient.verify?.(p, a) ?? Promise.resolve(true),
          },
          {
            journal,
            httpClient: ctx.httpClient,
            lock,
            tenantAllowlist: undefined,
            folderAllowlist: undefined,
          },
        );

      // 1. board
      const boardPlan = resourceClient.boards.planCreate(
        { name: "Sprint Board", type: "scrum", projectKeyOrId: "PROJ" },
        ENVELOPE_ID,
      );
      const boardOutcome = await apply(boardPlan);
      expect(boardOutcome.status).toBe("recorded");
      expect(boardOutcome.appliedRevision).toBe("1");

      // 2. sprint
      const sprintPlan = resourceClient.sprints.planCreate(
        { boardId: 1, name: "Sprint 1" },
        ENVELOPE_ID,
      );
      const sprintOutcome = await apply(sprintPlan);
      expect(sprintOutcome.status).toBe("recorded");
      expect(sprintOutcome.appliedRevision).toBe("10");

      // 3. epic (an issue with issueType "Epic")
      const epicPlan = resourceClient.issues.planCreate(
        { projectKeyOrId: "PROJ", issueType: "Epic", summaryAdf: toADF("Epic summary") },
        ENVELOPE_ID,
      );
      const epicOutcome = await apply(epicPlan);
      expect(epicOutcome.status).toBe("recorded");
      expect(epicOutcome.appliedRevision).toBe("PROJ-1");

      // 4. issue (a Story under the epic)
      const issuePlan = resourceClient.issues.planCreate(
        { projectKeyOrId: "PROJ", issueType: "Story", summaryAdf: toADF("Story summary") },
        ENVELOPE_ID,
      );
      const issueOutcome = await apply(issuePlan);
      expect(issueOutcome.status).toBe("recorded");
      expect(issueOutcome.appliedRevision).toBe("PROJ-2");

      // 5. link (story -> epic)
      const linkPlan = resourceClient.issues.planLink(
        { linkType: "is child of", outwardIssueKey: "PROJ-2", inwardIssueKey: "PROJ-1" },
        ENVELOPE_ID,
      );
      const linkOutcome = await apply(linkPlan);
      expect(linkOutcome.status).toBe("recorded");

      // 6. comment — ADF/text conversion round trip: markdown -> toADF -> plan -> apply
      const markdown = "Outcome: **linked** the story to its epic.";
      const commentPlan = resourceClient.comments.planCreate(
        "PROJ-2",
        toADF(markdown),
        "flow-marker-1",
        ENVELOPE_ID,
      );
      const commentOutcome = await apply(commentPlan);
      expect(commentOutcome.status).toBe("recorded");
      expect(commentOutcome.appliedRevision).toBe("50001");

      // 7. worklog
      const worklogPlan = resourceClient.worklogs.planCreate(
        "PROJ-2",
        { timeSpentSeconds: 3600 },
        ENVELOPE_ID,
      );
      const worklogOutcome = await apply(worklogPlan);
      expect(worklogOutcome.status).toBe("recorded");
      expect(worklogOutcome.appliedRevision).toBe("30001");

      // 8. attachment
      const stagingId = attachmentStaging.stage({
        filename: "log.txt",
        mimeType: "text/plain",
        content: Buffer.from("attachment bytes"),
      });
      const attachmentPlan = resourceClient.attachments.planUpload(
        "PROJ-2",
        { stagingId, filename: "log.txt", sizeBytes: 17 },
        ENVELOPE_ID,
      );
      const attachmentOutcome = await apply(attachmentPlan);
      expect(attachmentOutcome.status).toBe("recorded");
      expect(attachmentOutcome.appliedRevision).toBe("40001");

      transport.settle(8);
    });
  });

  describe("transitions", () => {
    it("issue.transition applies and its read-back verify confirms the status actually changed", async () => {
      const transport = openTransport(regime, "transition");
      const ctx = buildCtx(transport.send);
      const payloadRegistry = new JiraPlanPayloadRegistry();
      const resourceClient = createJiraResourceClient({
        ctx,
        fieldMetadataIndex: buildFieldMetadataIndex([]),
        payloadRegistry,
      });
      const applyClient = createJiraMutationApplyClient({
        ctx,
        payloadRegistry,
        attachmentStaging: new AttachmentStagingRegistry(),
        issueMarkerReconciler: { findByMarker: async () => undefined },
        commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
      });

      const plan = await resourceClient.issues.planTransition(
        "PROJ-2",
        "rev-before-transition",
        "31",
        ENVELOPE_ID,
        true, // hasVerificationEvidence — required for a done-targeting transition
      );

      const outcome = await executeMutationPlan(
        plan,
        {
          provider: "jira-cloud",
          buildRequest: (p) => applyClient.buildRequest(p),
          parseResponse: (p, r) => applyClient.parseResponse(p, r),
          verify: (p, a) => applyClient.verify?.(p, a) ?? Promise.resolve(true),
        },
        {
          journal,
          httpClient: ctx.httpClient,
          lock: new IdempotencyKeyLock(),
          tenantAllowlist: undefined,
          folderAllowlist: undefined,
        },
      );

      expect(outcome.status).toBe("recorded");
      transport.settle(3);
    });
  });

  describe("concurrent-edit conflicts", () => {
    it("a 412 precondition-failed response on issue.update fails as a typed conflict, never a silent overwrite", async () => {
      const transport = openTransport(regime, "conflict");
      const ctx = buildCtx(transport.send);
      const payloadRegistry = new JiraPlanPayloadRegistry();
      const resourceClient = createJiraResourceClient({
        ctx,
        fieldMetadataIndex: buildFieldMetadataIndex([]),
        payloadRegistry,
      });
      const applyClient = createJiraMutationApplyClient({
        ctx,
        payloadRegistry,
        attachmentStaging: new AttachmentStagingRegistry(),
        issueMarkerReconciler: { findByMarker: async () => undefined },
        commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
      });

      const plan = resourceClient.issues.planUpdate(
        "PROJ-2",
        "stale-revision",
        { summary: "an edit based on stale data" },
        ENVELOPE_ID,
      );

      const outcome = await executeMutationPlan(
        plan,
        {
          provider: "jira-cloud",
          buildRequest: (p) => applyClient.buildRequest(p),
          parseResponse: (p, r) => applyClient.parseResponse(p, r),
          verify: (p, a) => applyClient.verify?.(p, a) ?? Promise.resolve(true),
        },
        {
          journal,
          httpClient: ctx.httpClient,
          lock: new IdempotencyKeyLock(),
          tenantAllowlist: undefined,
          folderAllowlist: undefined,
        },
      );

      expect(outcome.status).toBe("failed");
      expect(outcome.errorKind).toBe("conflict");
      transport.settle(1);
    });
  });
});

/**
 * Cassette-only checks. These have no fake-arm counterpart by
 * construction — they are about the FIXTURE, not about the connector.
 */
describe("write-scenario cassette — fixture integrity and disclosed provenance", () => {
  it("every recorded response body still hashes to the sha-256 digest recorded beside it", () => {
    const cassette = loadWriteScenarioCassette();
    expect(Object.keys(cassette.sections)).toEqual(["chain", "transition", "conflict"]);

    let checked = 0;
    for (const section of Object.values(cassette.sections)) {
      for (const entry of section.entries) {
        expect(recomputeBodyDigest(entry.response.bodyText)).toBe(entry.bodyDigest);
        checked += 1;
      }
    }
    // Guard instrumentation (verification-playbook §Guard instrumentation):
    // name the count, so a loop that silently iterated zero entries cannot
    // pass as a verification.
    expect(checked).toBe(12);
  });

  it("pins the hand-authored provenance disclosure so it cannot be dropped silently", () => {
    const { provenance } = loadWriteScenarioCassette();
    expect(provenance.capture).toBe("hand-authored");
    expect(provenance.capturedFrom).toBeNull();
    expect(provenance.notEvidenceFor).toContain("exit criterion 9");
  });
});
