import { describe, expect, it } from "vitest";
import {
  CapabilitySnapshotSchema,
  ConnectorError,
  CONNECTOR_ERROR_KINDS,
  CURRENT_SCHEMA_VERSION,
} from "@eo/contracts";
import { folderDefinition } from "../resources/definitions/folder.js";
import { contactPointDefinition } from "../resources/definitions/contact-point.js";
import { notificationTemplateDefinition } from "../resources/definitions/notification-template.js";
import { restoreFromSnapshot, type RollbackHttpResponse } from "../mutation/rollback.js";
import { GrafanaRollbackSnapshotStore } from "../mutation/snapshot-store.js";
import { assertWritableCapability } from "../mutation/write-eligibility-guard.js";
import { checkGrafanaConnectionDoctor } from "../auth/connection-doctor.js";
import type { GrafanaParsedResource } from "../resources/resource-definitions.js";

/**
 * roadmap/20-grafana-adapters.md §Test plan, "Conformance": "every thrown
 * error is one of 02's 10 canonical members with no raw Grafana response
 * body attached (leak-hunt assertion)." This sweeps every error-producing
 * surface THIS package adds on top of `@eo/gateway`'s own (already-tested)
 * canonical-error mapping.
 */

const SECRET_MARKER = "sk-super-secret-token-should-never-leak-9f8e7d";

describe("leak-hunt — restoreFromSnapshot never echoes a raw response body containing secret-shaped content", () => {
  const snapshot: GrafanaParsedResource = {
    kind: "folder",
    externalId: "fold-1",
    revision: "etag-1",
    fields: { title: "Team Dashboards", parentUid: null },
  };

  it("a 500 response body containing the secret marker never appears in the blocked reason", async () => {
    const send = async (): Promise<RollbackHttpResponse> => ({
      status: 500,
      headers: {},
      bodyText: JSON.stringify({ error: "internal", token: SECRET_MARKER }),
    });
    const outcome = await restoreFromSnapshot(folderDefinition, "/api/folders", snapshot, { send });
    expect(outcome.status).toBe("blocked");
    expect(JSON.stringify(outcome)).not.toContain(SECRET_MARKER);
  });

  it("a write-failure response body containing the secret marker never appears in the blocked reason", async () => {
    let call = 0;
    const send = async (): Promise<RollbackHttpResponse> => {
      call += 1;
      if (call === 1) return { status: 200, headers: {}, bodyText: JSON.stringify({ title: "x" }) };
      return { status: 412, headers: {}, bodyText: JSON.stringify({ message: SECRET_MARKER }) };
    };
    const outcome = await restoreFromSnapshot(folderDefinition, "/api/folders", snapshot, { send });
    expect(outcome.status).toBe("blocked");
    expect(JSON.stringify(outcome)).not.toContain(SECRET_MARKER);
  });
});

describe("leak-hunt — assertWritableCapability throws a canonical ConnectorError with no raw snapshot dump", () => {
  it("the thrown error is exactly one of the 10 canonical kinds, serializes only to {kind,message,provider,retryable,redactedDetail}", () => {
    const snapshot = CapabilitySnapshotSchema.parse({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: "00000000-0000-4000-8000-000000000401",
      externalConnectionId: "00000000-0000-4000-8000-000000000402",
      product: "grafana",
      edition: "oss",
      version: "9.0.7",
      apiFamilies: [],
      resources: [],
      actions: [],
      permissions: [],
      isReadOnly: true,
      discoveredAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    });

    let caught: unknown;
    try {
      assertWritableCapability(snapshot);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConnectorError);
    const err = caught as ConnectorError;
    expect(CONNECTOR_ERROR_KINDS).toContain(err.kind);
    expect(Object.keys(err.toData()).sort()).toEqual(
      ["kind", "message", "provider", "retryable", "redactedDetail"].sort(),
    );
  });
});

describe("leak-hunt — adversarial-review MEDIUM fix: a contact-point secret never survives into a canonical read-back, a rollback snapshot, or the verify() comparison baseline", () => {
  const REAL_WEBHOOK_SECRET = "sk-webhook-super-secret-should-never-leak-4a1b2c";

  it("parseCanonical (the canonical read-back-compare result attachable to an EvidenceRecord) never contains the raw secret", () => {
    const bodyText = JSON.stringify({
      uid: "cp-1",
      name: "on-call-webhook",
      type: "webhook",
      settings: { url: "https://hooks.example.com/x", authorization: REAL_WEBHOOK_SECRET },
      version: 1,
    });
    const canonical = contactPointDefinition.parseCanonical("cp-1", bodyText, {});
    expect(JSON.stringify(canonical)).not.toContain(REAL_WEBHOOK_SECRET);
    expect((canonical.fields.settings as Record<string, unknown>).authorization).toBe("[redacted]");
  });

  it("a rollback snapshot captured before an update never contains the raw secret", () => {
    const store = new GrafanaRollbackSnapshotStore();
    const bodyText = JSON.stringify({
      uid: "cp-1",
      name: "on-call-webhook",
      type: "webhook",
      settings: { url: "https://hooks.example.com/x", password: REAL_WEBHOOK_SECRET },
    });
    const canonical = contactPointDefinition.parseCanonical("cp-1", bodyText, {});
    store.capture("plan-1", canonical);
    expect(JSON.stringify(store.get("plan-1"))).not.toContain(REAL_WEBHOOK_SECRET);
  });

  it("canonicalizeDesiredInput (the verify() comparison baseline) never carries the raw secret either, while buildCreateRequest's actual wire body still does (required for the real mutation to work)", () => {
    const input = {
      name: "on-call-webhook",
      type: "webhook",
      settings: { url: "https://hooks.example.com/x", password: REAL_WEBHOOK_SECRET },
    };
    const desired = contactPointDefinition.canonicalizeDesiredInput(input, {
      action: "create",
      deterministicUid: "uid-1",
    });
    expect(JSON.stringify(desired)).not.toContain(REAL_WEBHOOK_SECRET);

    const wireRequest = contactPointDefinition.buildCreateRequest(
      "/api/v1/provisioning/contact-points",
      input,
      "uid-1",
    );
    expect(JSON.stringify(wireRequest)).toContain(REAL_WEBHOOK_SECRET); // the REAL request sent to Grafana must still carry it
  });

  it("a credential-shaped secret pasted into a notification-template body never survives into the canonical read-back", () => {
    const bodyText = JSON.stringify({
      uid: "tmpl-1",
      name: "slack",
      template: `use token ${REAL_WEBHOOK_SECRET.replace("sk-webhook", "glsa_abcdefghijklmnopqrstuvwx")}`,
    });
    const canonical = notificationTemplateDefinition.parseCanonical("tmpl-1", bodyText, {});
    expect(JSON.stringify(canonical)).not.toContain("glsa_abcdefghijklmnopqrstuvwx");
  });
});

describe("leak-hunt — connection-doctor never echoes any field beyond orgId/role, even when the fixture attaches extra sensitive-looking data", () => {
  it("a token-info response with extra fields never leaks those fields into the result", async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: async () =>
        ({
          orgId: 7,
          role: "Editor",
          // Extra fields a real response might carry — must never surface.
          rawToken: SECRET_MARKER,
        }) as { orgId: number; role: string },
      orgAllowlist: ["7"],
    });
    expect(JSON.stringify(result)).not.toContain(SECRET_MARKER);
    expect(Object.keys(result).sort()).toEqual(["ok", "orgId", "role"].sort());
  });
});
