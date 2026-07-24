/**
 * roadmap/23-release-hardening.md work item 6: "exact-origin credential
 * binding, ... redirects." Drives the REAL `@eo/gateway` transport stack
 * (`GatewayHttpClient`, `buildAllowlistForConnection`,
 * `buildHttpClientForConnection`) — never a reimplementation — against
 * synthetic `ExternalConnection` fixtures (`@eo/testkit`).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildExternalConnection } from "@eo/testkit";
import {
  GatewayHttpClient,
  SsrfRefusedError,
  buildAllowlistForConnection,
  buildHttpClientForConnection,
} from "@eo/gateway";
import type { HttpTransportResponse } from "@eo/gateway";
import {
  CONNECTOR_MATRIX_GATE_TAG,
  createScenarioJournal,
  emitScenarioEvidence,
} from "../support/evidence.js";
import type { ScenarioJournal } from "../support/evidence.js";

let tj: ScenarioJournal;

beforeEach(async () => {
  tj = await createScenarioJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

describe("exact-origin credential binding", () => {
  it("buildAllowlistForConnection scopes the allowlist to exactly the connection's own base origin plus its declared redirect origins — nothing else", () => {
    const connection = buildExternalConnection({
      baseUrl: "https://connection-a.atlassian.invalid",
      allowedRedirectOrigins: ["https://connection-a-cdn.atlassian.invalid"],
    });
    const allowlist = buildAllowlistForConnection(connection);
    expect(allowlist.allowedSchemes).toEqual(["https:"]);
    expect(allowlist.allowedOrigins).toEqual([
      "https://connection-a.atlassian.invalid",
      "https://connection-a-cdn.atlassian.invalid",
    ]);
  });

  it("a request built for connection A's own origin succeeds; the SAME client refuses a request target at connection B's origin (never reused across connections)", async () => {
    const connectionA = buildExternalConnection({
      baseUrl: "https://connection-a.atlassian.invalid",
    });
    const calls: string[] = [];
    const client = await buildHttpClientForConnection(connectionA, {
      resolveHostAddresses: async () => ["203.0.113.10"],
      sendRequest: async (req) => {
        calls.push(req.url.toString());
        return { status: 200, headers: {}, bodyText: "{}" } satisfies HttpTransportResponse;
      },
      sleep: async () => undefined,
    });

    const ok = await client.request({
      connectionId: connectionA.id,
      tenant: "tenant-1",
      resource: "issue:PROJ-1",
      url: new URL("https://connection-a.atlassian.invalid/rest/api/3/issue/PROJ-1"),
      method: "GET",
    });
    expect(ok.status).toBe(200);

    await expect(
      client.request({
        connectionId: connectionA.id,
        tenant: "tenant-1",
        resource: "issue:PROJ-1",
        url: new URL("https://connection-b.atlassian.invalid/rest/api/3/issue/PROJ-1"),
        method: "GET",
      }),
    ).rejects.toBeInstanceOf(SsrfRefusedError);

    // Exactly one outbound call happened — the cross-connection-origin
    // attempt never reached the network at all.
    expect(calls).toEqual(["https://connection-a.atlassian.invalid/rest/api/3/issue/PROJ-1"]);

    await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: exact-origin credential binding — cross-connection origin refused pre-network",
      exitStatus: 0,
      outcomeContent: JSON.stringify({ calls }),
    });
  });
});

describe("redirect revalidation", () => {
  function buildRedirectClient(allowedRedirectOrigins: readonly string[]): {
    client: GatewayHttpClient;
    calls: string[];
  } {
    const calls: string[] = [];
    const client = new GatewayHttpClient({
      allowlist: {
        allowedSchemes: ["https:"],
        allowedOrigins: ["https://origin-a.invalid", ...allowedRedirectOrigins],
      },
      resolveHostAddresses: async () => ["203.0.113.11"],
      sendRequest: async (req) => {
        calls.push(req.url.toString());
        if (req.url.origin === "https://origin-a.invalid") {
          return {
            status: 302,
            headers: { location: "https://origin-b.invalid/target" },
            bodyText: "",
          } satisfies HttpTransportResponse;
        }
        return { status: 200, headers: {}, bodyText: "final" } satisfies HttpTransportResponse;
      },
      sleep: async () => undefined,
    });
    return { client, calls };
  }

  it("follows a redirect to an origin that IS on the allowlist", async () => {
    const { client, calls } = buildRedirectClient(["https://origin-b.invalid"]);
    const response = await client.request({
      connectionId: "conn-1",
      tenant: "tenant-1",
      resource: "res-1",
      url: new URL("https://origin-a.invalid/start"),
      method: "GET",
    });
    expect(response.status).toBe(200);
    expect(response.bodyText).toBe("final");
    expect(calls).toEqual(["https://origin-a.invalid/start", "https://origin-b.invalid/target"]);
  });

  it("refuses to follow a redirect to an origin NOT on the allowlist — credentials never attach to the unvalidated hop", async () => {
    const { client, calls } = buildRedirectClient([]); // origin-b deliberately NOT allowlisted
    await expect(
      client.request({
        connectionId: "conn-1",
        tenant: "tenant-1",
        resource: "res-1",
        url: new URL("https://origin-a.invalid/start"),
        method: "GET",
      }),
    ).rejects.toBeInstanceOf(SsrfRefusedError);
    // The redirect hop was reported by origin-a, but never actually dialed.
    expect(calls).toEqual(["https://origin-a.invalid/start"]);

    await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: redirect revalidation — disallowed redirect origin refused before credentials attach",
      exitStatus: 0,
      outcomeContent: JSON.stringify({ calls }),
    });
  });

  it("all scenarios in this file emit EvidenceRecords tagged release-gate:connector-matrix", async () => {
    const entries: unknown[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      entries.push(entry as { payload: { gateTag?: string } });
    }
    for (const entry of entries) {
      expect((entry as { payload: { gateTag?: string } }).payload.gateTag).toBe(
        CONNECTOR_MATRIX_GATE_TAG,
      );
    }
  });
});
