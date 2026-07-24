import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import {
  GatewayHttpClient,
  IdempotencyKeyLock,
  createFakeProviderTransport,
  executeMutationPlan,
  midPostTimeoutFault,
} from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import { JiraTokenManager } from "../auth/token-manager.js";
import { AttachmentStagingRegistry } from "../attachments/attachment-staging.js";
import { createJiraEntityPropertyMarkerReconciler } from "../reconciliation/entity-property-marker.js";
import { createJiraMutationApplyClient } from "./jira-mutation-apply-client.js";
import { createJiraResourceClient } from "./jira-resource-client.js";
import { JiraPlanPayloadRegistry } from "./plan-payload-registry.js";
import { buildFieldMetadataIndex } from "../capability/field-metadata.js";
import type { JiraHttpContext } from "./http-read-helper.js";

/**
 * roadmap/18 §Exit criteria: "Exactly-once via entity-property markers
 * proven under injected POST timeout (no duplicate comments/issues)."
 * Work item 6 entry point / §Test plan Conformance bullet: "ambiguous
 * mid-POST timeout ... must fail with no handling before the fix, pass
 * after." This wires this connector's REAL `createJiraMutationApplyClient`
 * through `@eo/gateway`'s REAL `executeMutationPlan` and a REAL
 * (temp-dir-backed) journal — never a shortcut — to prove the full
 * pipeline end-to-end.
 */
const BASE_URL = "https://exactly-once-test.atlassian.invalid";

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-connectors-jira-exactly-once-"));
  journal = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function buildCtx(): {
  ctx: JiraHttpContext;
  fakeSend: ReturnType<typeof createFakeProviderTransport>["send"];
  script: { responses: { status: number; bodyText?: string; fault?: string }[] };
} {
  const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
  const script = { responses: [midPostTimeoutFault()] };
  const fake = createFakeProviderTransport(script);
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.70"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  const tokenManager = new JiraTokenManager({
    fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
  });
  return { ctx: { connection, httpClient, tokenManager }, fakeSend: fake.send, script };
}

describe("exactly-once via entity-property markers under an injected mid-POST timeout", () => {
  it("issue.create: a mid-POST timeout followed by a found marker resolves to a single recorded issue, never a duplicate POST", async () => {
    const { ctx } = buildCtx();
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const attachmentStaging = new AttachmentStagingRegistry();
    const resourceClient = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry,
    });

    const plan = resourceClient.issues.planCreate(
      {
        projectKeyOrId: "PROJ",
        issueType: "Task",
        summaryAdf: { type: "doc", version: 1, content: [] },
      },
      "88888888-8888-4888-8888-888888888888",
    );

    // The marker reconciler simulates: after the timeout, a search for
    // this exact plan's idempotency-key marker DOES find the issue that
    // actually landed (the POST succeeded remotely despite the client-
    // observed timeout) — proving reconciliation, not a blind retry, is
    // what resolves the ambiguity.
    const issueMarkerReconciler = createJiraEntityPropertyMarkerReconciler(ctx, "issue");
    // Override findByMarker to simulate a successful indexed lookup
    // without needing a second scripted HTTP call.
    issueMarkerReconciler.findByMarker = async (marker) =>
      marker === plan.idempotencyKey ? "PROJ-500" : undefined;

    const applyClient = createJiraMutationApplyClient({
      ctx,
      payloadRegistry,
      attachmentStaging,
      issueMarkerReconciler,
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });

    const outcome = await executeMutationPlan(
      plan,
      {
        provider: "jira-cloud",
        buildRequest: (p) => applyClient.buildRequest(p),
        parseResponse: (p, r) => applyClient.parseResponse(p, r),
        verify: async () => true,
        reconcileAmbiguous: (p, cause) =>
          applyClient.reconcileAmbiguous?.(p, cause) ?? Promise.resolve(undefined),
      },
      { journal, httpClient: ctx.httpClient, lock: new IdempotencyKeyLock() },
    );

    expect(outcome.status).toBe("recorded");
    expect(outcome.appliedRevision).toBe("PROJ-500");

    // Replaying the SAME plan again must hit the journal's own replay
    // path — never re-invoke the network at all.
    const replay = await executeMutationPlan(
      plan,
      {
        provider: "jira-cloud",
        buildRequest: (p) => applyClient.buildRequest(p),
        parseResponse: (p, r) => applyClient.parseResponse(p, r),
        verify: async () => true,
      },
      { journal, httpClient: ctx.httpClient, lock: new IdempotencyKeyLock() },
    );
    expect(replay.status).toBe("replayed");
    expect(replay.appliedRevision).toBe("PROJ-500");
  });

  it("issue.create: a mid-POST timeout with NO marker found blocks — never guesses, never duplicates", async () => {
    const { ctx } = buildCtx();
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const attachmentStaging = new AttachmentStagingRegistry();
    const resourceClient = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry,
    });

    const plan = resourceClient.issues.planCreate(
      {
        projectKeyOrId: "PROJ",
        issueType: "Task",
        summaryAdf: { type: "doc", version: 1, content: [] },
      },
      "99999999-9999-4999-8999-999999999999",
    );

    const applyClient = createJiraMutationApplyClient({
      ctx,
      payloadRegistry,
      attachmentStaging,
      issueMarkerReconciler: { findByMarker: async () => undefined }, // never found
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });

    const outcome = await executeMutationPlan(
      plan,
      {
        provider: "jira-cloud",
        buildRequest: (p) => applyClient.buildRequest(p),
        parseResponse: (p, r) => applyClient.parseResponse(p, r),
        verify: async () => true,
        reconcileAmbiguous: (p, cause) =>
          applyClient.reconcileAmbiguous?.(p, cause) ?? Promise.resolve(undefined),
      },
      { journal, httpClient: ctx.httpClient, lock: new IdempotencyKeyLock() },
    );

    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKind).toBe("ambiguous_write");
  });

  // MEDIUM M1 (adversarial-review): comment.create's stamped marker and
  // its reconciliation search previously used DIFFERENT strings (the
  // bare caller-supplied marker vs. `plan.idempotencyKey`), so a comment
  // that DID land after a mid-POST timeout could never be found again —
  // this test wires the REAL `createJiraEntityPropertyMarkerReconciler`
  // (never a stubbed `findByMarker` override) against a scripted
  // `listComments` response whose comment carries `properties.marker`
  // set to `plan.idempotencyKey`, proving the fix end-to-end: what
  // `buildRequest` stamps is exactly what reconciliation searches for.
  it("comment.create: a mid-POST timeout followed by a REAL entity-property search recovers the landed comment, never a duplicate POST", async () => {
    const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const attachmentStaging = new AttachmentStagingRegistry();

    // `planCommentCreate`'s idempotencyKey is deterministic
    // (`comment.create:${issueKey}:${marker}`) — computed here, before
    // any transport exists, purely to script the fixture's landed-comment
    // property value below (planning is local-only; no network I/O).
    const issueKey = "PROJ-1";
    const marker = "milestone-sync:PROJ-1:start";
    const expectedIdempotencyKey = `comment.create:${issueKey}:${marker}`;

    const fake = createFakeProviderTransport({
      responses: [
        midPostTimeoutFault(), // the client-observed-as-timed-out POST
        // The real listComments search the entity-property reconciler
        // performs — the landed comment carries `plan.idempotencyKey`
        // (never the bare marker) as its stamped property, exactly as
        // the fixed `buildRequest` now stamps it.
        {
          status: 200,
          bodyText: JSON.stringify({
            comments: [
              { id: "60001", body: {}, properties: {} }, // an unrelated comment — must not match
              { id: "60002", body: {}, properties: { marker: expectedIdempotencyKey } },
            ],
          }),
        },
      ],
    });
    const httpClient = new GatewayHttpClient({
      allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
      resolveHostAddresses: async () => ["203.0.113.71"],
      sendRequest: fake.send,
      sleep: async () => undefined,
    });
    const tokenManager = new JiraTokenManager({
      fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
    });
    const ctx: JiraHttpContext = { connection, httpClient, tokenManager };
    const resourceClient = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry,
    });

    const plan = resourceClient.comments.planCreate(
      issueKey,
      { type: "doc", version: 1, content: [] },
      marker,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(plan.idempotencyKey).toBe(expectedIdempotencyKey);

    const applyClient = createJiraMutationApplyClient({
      ctx,
      payloadRegistry,
      attachmentStaging,
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: (key) =>
        createJiraEntityPropertyMarkerReconciler(ctx, "comment", key),
    });

    const outcome = await executeMutationPlan(
      plan,
      {
        provider: "jira-cloud",
        buildRequest: (p) => applyClient.buildRequest(p),
        parseResponse: (p, r) => applyClient.parseResponse(p, r),
        verify: async () => true,
        reconcileAmbiguous: (p, cause) =>
          applyClient.reconcileAmbiguous?.(p, cause) ?? Promise.resolve(undefined),
      },
      { journal, httpClient: ctx.httpClient, lock: new IdempotencyKeyLock() },
    );

    expect(outcome.status).toBe("recorded");
    expect(outcome.appliedRevision).toBe("60002");
    // Exactly one POST attempt reached the network (the timed-out one) —
    // the recovery path never re-POSTs.
    expect(fake.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
});
