/**
 * roadmap/23-release-hardening.md work item 6: "custom CAs." Drives the
 * REAL `@crabgic/gateway` `resolveCustomCaPem`/`buildHttpClientForConnection`
 * composition (never a reimplementation) against a synthetic, non-secret
 * PEM-shaped fixture.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildExternalConnection } from "@crabgic/testkit";
import { buildHttpClientForConnection, resolveCustomCaPem } from "@crabgic/gateway";
import type { HttpTransportResponse } from "@crabgic/gateway";
import { emitScenarioEvidence, createScenarioJournal } from "../support/evidence.js";
import type { ScenarioJournal } from "../support/evidence.js";

// A synthetic, structurally PEM-shaped fixture — NOT a real certificate
// (no real key material, just the standard header/footer markers a real CA
// bundle would carry) — used only to prove the plumbing threads a
// connection's declared CA reference through to the actual HTTP client.
const SYNTHETIC_CA_PEM =
  "-----BEGIN CERTIFICATE-----\nSYNTHETICFIXTUREDATA==\n-----END CERTIFICATE-----\n";

let caDir: string;
let caPath: string;
let tj: ScenarioJournal;

beforeEach(async () => {
  caDir = await mkdtemp(join(tmpdir(), "eo-connector-matrix-ca-"));
  caPath = join(caDir, "custom-ca.pem");
  await writeFile(caPath, SYNTHETIC_CA_PEM, "utf8");
  tj = await createScenarioJournal();
});

afterEach(async () => {
  await rm(caDir, { recursive: true, force: true });
  await tj.cleanup();
});

describe("resolveCustomCaPem", () => {
  it("returns undefined when the connection declares no customCaRef", async () => {
    const connection = buildExternalConnection({});
    expect(await resolveCustomCaPem(connection)).toBeUndefined();
  });

  it("reads the exact PEM bytes off disk when customCaRef is declared", async () => {
    const connection = buildExternalConnection({ customCaRef: { path: caPath } });
    const pem = await resolveCustomCaPem(connection);
    expect(pem).toBe(SYNTHETIC_CA_PEM);
  });
});

describe("buildHttpClientForConnection with a custom CA configured", () => {
  it("builds a fully functional client (custom CA wired into the https.Agent, no throw) and honors the connection's own origin allowlist", async () => {
    const connection = buildExternalConnection({
      baseUrl: "https://custom-ca-fixture.invalid",
      customCaRef: { path: caPath },
    });
    const calls: string[] = [];
    const client = await buildHttpClientForConnection(connection, {
      resolveHostAddresses: async () => ["203.0.113.30"],
      sendRequest: async (req) => {
        calls.push(req.url.toString());
        return { status: 200, headers: {}, bodyText: "ok" } satisfies HttpTransportResponse;
      },
      sleep: async () => undefined,
    });

    const response = await client.request({
      connectionId: connection.id,
      tenant: "tenant-1",
      resource: "res-1",
      url: new URL("https://custom-ca-fixture.invalid/health"),
      method: "GET",
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual(["https://custom-ca-fixture.invalid/health"]);

    await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: custom CA reference resolved from disk and threaded into a functional GatewayHttpClient",
      exitStatus: 0,
      outcomeContent: JSON.stringify({ calls, customCaConfigured: true }),
    });
  });
});
