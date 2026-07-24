/**
 * roadmap/23-release-hardening.md work item 6: "a secret-shaped payload
 * must be BLOCKED." Two independent, REAL defense-in-depth layers, both
 * reused (never reimplemented):
 *
 *  1. `@eo/renderer`'s `lint()` secret-scan stage — the general
 *     communication-artifact guard, exercised across several
 *     `ArtifactKind`s.
 *  2. `@eo/connectors-jira`'s Jira apply-boundary guard
 *     (`createJiraMutationApplyClient(...).buildRequest`, via
 *     `assertSafeAdfDocument`/`containsSecretShapedContent`) — a SECOND,
 *     independent check specifically at the point a Jira mutation would
 *     otherwise go out over the wire, proving the secret is blocked
 *     PRE-NETWORK even if a caller somehow bypassed layer 1.
 *
 * Every secret value below is a SYNTHETIC sentinel (`../support/fixtures.ts`)
 * — never a real credential.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectorError, DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import {
  ARTIFACT_KINDS,
  lint,
  renderJiraMilestoneComment,
  renderPrBody,
  renderReviewComment,
  toADF,
  type ArtifactKind,
} from "@eo/renderer";
import { buildExternalConnection } from "@eo/testkit";
import { GatewayHttpClient, createFakeProviderTransport } from "@eo/gateway";
import {
  JiraTokenManager,
  JiraPlanPayloadRegistry,
  AttachmentStagingRegistry,
  buildJiraMutationPlan,
  createJiraMutationApplyClient,
  type JiraHttpContext,
} from "@eo/connectors-jira";
import {
  CONNECTOR_MATRIX_GATE_TAG,
  createScenarioJournal,
  emitScenarioEvidence,
} from "../support/evidence.js";
import type { ScenarioJournal } from "../support/evidence.js";
import { SYNTHETIC_AWS_ACCESS_KEY, SYNTHETIC_ANTHROPIC_KEY } from "../support/fixtures.js";

let tj: ScenarioJournal;

beforeEach(async () => {
  tj = await createScenarioJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

describe("layer 1 — real @eo/renderer lint() secret-scan stage blocks synthetic secret sentinels", () => {
  const KINDS_TO_CHECK: readonly ArtifactKind[] = [
    "pr_body",
    "review_comment",
    "jira_milestone_comment",
  ];

  function candidateEmbedding(kind: ArtifactKind, secret: string): string {
    if (kind === "pr_body") {
      return renderPrBody({
        outcome: "rotated the deploy credentials",
        validation: `confirmed the old key ${secret} is deactivated`,
        risk: "none",
        tracking: "PROJ-23",
      });
    }
    if (kind === "review_comment") {
      return renderReviewComment({
        finding: "a credential is hardcoded",
        evidence: `src/config.ts:1 contains ${secret}`,
        action: "move it to a secret manager",
      });
    }
    return renderJiraMilestoneComment({
      outcome: "credential rotation complete",
      evidence: `old key ${secret} revoked`,
      risk: "none",
      next: "monitor",
      ref: "PROJ-23",
    });
  }

  it("AWS-style and Anthropic-style synthetic secret sentinels are both blocked, across every checked ArtifactKind", async () => {
    const outcomes: Record<string, unknown> = {};
    for (const kind of KINDS_TO_CHECK) {
      for (const secret of [SYNTHETIC_AWS_ACCESS_KEY, SYNTHETIC_ANTHROPIC_KEY]) {
        const candidate = candidateEmbedding(kind, secret);
        const outcome = lint(candidate, kind, DEFAULT_COMMUNICATION_POLICY);
        outcomes[`${kind}:${secret}`] = outcome;
        expect(outcome.ok, `${kind}/${secret} unexpectedly passed lint()`).toBe(false);
        if (outcome.ok) continue;
        expect(outcome.findings.some((f) => f.stage === "secret-scan")).toBe(true);
      }
    }

    await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: secret-leakage — real lint() secret-scan stage blocks synthetic sentinels",
      exitStatus: 0,
      outcomeContent: JSON.stringify(outcomes),
    });
  });

  it("control: the same templates WITHOUT a secret embedded clear lint() cleanly", () => {
    for (const kind of KINDS_TO_CHECK) {
      const candidate = candidateEmbedding(kind, "no-secret-here");
      expect(lint(candidate, kind, DEFAULT_COMMUNICATION_POLICY).ok).toBe(true);
    }
  });
});

describe("layer 2 — real @eo/connectors-jira apply-boundary guard blocks the same sentinel PRE-NETWORK", () => {
  function buildHarness() {
    const connection = buildExternalConnection({
      provider: "jira-cloud",
      baseUrl: "https://secret-leakage-fixture.atlassian.invalid",
    });
    const fake = createFakeProviderTransport({ responses: [{ status: 200, bodyText: "{}" }] });
    const httpClient = new GatewayHttpClient({
      allowlist: {
        allowedSchemes: ["https:"],
        allowedOrigins: [new URL(connection.baseUrl).origin],
      },
      resolveHostAddresses: async () => ["203.0.113.201"],
      sendRequest: fake.send,
      sleep: async () => undefined,
    });
    const tokenManager = new JiraTokenManager({
      fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
    });
    const ctx: JiraHttpContext = { connection, httpClient, tokenManager };
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const attachmentStaging = new AttachmentStagingRegistry();
    const applyClient = createJiraMutationApplyClient({
      ctx,
      payloadRegistry,
      attachmentStaging,
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    return { connection, fake, applyClient, payloadRegistry };
  }

  it("a comment.create plan whose ADF body embeds the synthetic secret throws ConnectorError.policy_blocked at buildRequest — zero outbound calls", () => {
    const { fake, applyClient, payloadRegistry } = buildHarness();
    const maliciousMarkdown = `Rotated the old key ${SYNTHETIC_AWS_ACCESS_KEY} — please confirm.`;
    const plan = buildJiraMutationPlan({
      tenant: "tenant-1",
      externalConnectionId: "00000000-0000-4000-8000-000000000601",
      payloadRegistry,
      canonicalTarget: "issue:PROJ-1:comment",
      action: "comment.create",
      redactedDiff: "comment: (new) -> [redacted secret-leakage fixture]",
      desiredStatePayload: { bodyAdf: toADF(maliciousMarkdown) },
      idempotencyKey: "secret-leakage-fixture:comment:create",
      impactClass: "reversible",
      rollbackClass: "none",
      envelopeId: randomUUID(),
    });

    let thrown: unknown;
    try {
      applyClient.buildRequest(plan);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ConnectorError);
    expect((thrown as ConnectorError).kind).toBe("policy_blocked");
    // Never echoes the raw secret value in the thrown error's own message.
    expect((thrown as ConnectorError).message).not.toContain(SYNTHETIC_AWS_ACCESS_KEY);
    expect(fake.calls).toHaveLength(0); // pre-network — no outbound HTTP call was ever attempted
  });

  it("control: the same plan shape with a benign comment body builds a request cleanly (proves this isn't a blanket comment.create ban)", () => {
    const { fake, applyClient, payloadRegistry } = buildHarness();
    const plan = buildJiraMutationPlan({
      tenant: "tenant-1",
      externalConnectionId: "00000000-0000-4000-8000-000000000601",
      payloadRegistry,
      canonicalTarget: "issue:PROJ-1:comment",
      action: "comment.create",
      redactedDiff: "comment: (new) -> benign fixture",
      desiredStatePayload: { bodyAdf: toADF("all clear, no action needed.") },
      idempotencyKey: "secret-leakage-fixture:comment:create:benign",
      impactClass: "reversible",
      rollbackClass: "none",
      envelopeId: randomUUID(),
    });
    const spec = applyClient.buildRequest(plan);
    expect(spec.method).toBe("POST");
    expect(fake.calls).toHaveLength(0); // buildRequest itself is still pure/no-I/O — matches this call's own contract
  });

  it("emits an EvidenceRecord tagged release-gate:connector-matrix for the apply-boundary defense layer", async () => {
    const { applyClient, payloadRegistry } = buildHarness();
    const plan = buildJiraMutationPlan({
      tenant: "tenant-1",
      externalConnectionId: "00000000-0000-4000-8000-000000000601",
      payloadRegistry,
      canonicalTarget: "issue:PROJ-1:comment",
      action: "comment.create",
      redactedDiff: "comment: (new) -> [redacted secret-leakage fixture]",
      desiredStatePayload: { bodyAdf: toADF(`leaked: ${SYNTHETIC_AWS_ACCESS_KEY}`) },
      idempotencyKey: "secret-leakage-fixture:comment:create:2",
      impactClass: "reversible",
      rollbackClass: "none",
      envelopeId: randomUUID(),
    });
    let kind: string | undefined;
    try {
      applyClient.buildRequest(plan);
    } catch (err) {
      kind = err instanceof ConnectorError ? err.kind : undefined;
    }
    // `@eo/connectors-jira`'s own `JIRA_SECRET_PATTERNS` set is narrower
    // than `@eo/renderer`'s (AWS-key/PEM-header/aws_secret_access_key= only
    // — see `packages/connectors-jira/src/security/secret-patterns.ts`'s
    // own doc comment), so this apply-boundary layer is checked here with
    // the AWS-style sentinel it DOES recognize (the Anthropic-style
    // sentinel is layer 1's — `lint()`'s broader `secret-scan` stage —
    // coverage, exercised above).
    expect(kind).toBe("policy_blocked");

    const record = await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: secret-leakage — real @eo/connectors-jira apply-boundary guard blocks synthetic sentinel pre-network",
      exitStatus: 0,
      outcomeContent: JSON.stringify({ blockedKind: kind }),
    });
    expect(record.gateTag).toBe(CONNECTOR_MATRIX_GATE_TAG);
    expect(ARTIFACT_KINDS.includes("jira_milestone_comment")).toBe(true);
  });
});
