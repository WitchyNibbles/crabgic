/**
 * Leak-hunt exit criterion (roadmap/16-gateway-core.md §Exit criteria):
 * "no raw provider body in any error, log, or artifact (live substring
 * search)." This test plants a distinctive secret marker inside a raw
 * provider response at every surface this package can produce an error,
 * log, or artifact from, then live-greps every observable output string
 * for that exact marker — proving none of them echo it.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { ConnectorError } from "@eo/contracts";
import { InMemoryExternalConnectionStore } from "../connection-store/external-connection-store.js";
import { ProviderRegistry } from "../provider-dispatch/provider-registry.js";
import { buildNativeToolRegistry } from "../mcp/native-registry.js";
import type { GenericProviderClient } from "../mcp/native-tools/provider-dispatch-tool.js";
import type { MutationApplyClient } from "../mcp/native-tools/mutation-apply-client.js";
import { mapHttpStatusToConnectorError, mapUnknownErrorToConnectorError } from "../mutation-pipeline/error-mapping.js";
import {
  executeMutationPlan,
  IdempotencyKeyLock,
  type MutationPipelineHandlers,
} from "../mutation-pipeline/mutation-pipeline.js";
import { GatewayHttpClient } from "../transport/http-client.js";
import type { HttpTransportResponse } from "../transport/http-transport.js";

const SECRET_MARKER = "LEAK-HUNT-SECRET-9f3a7c21";

/** Recursively collects every string value reachable from `value` — the "live substring search" surface. */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
  return out;
}

function assertNoLeak(surfaceName: string, value: unknown): void {
  const strings = collectStrings(value);
  const leaked = strings.filter((s) => s.includes(SECRET_MARKER));
  expect(leaked, `${surfaceName} leaked the raw secret marker: ${JSON.stringify(leaked)}`).toEqual([]);
}

describe("leak hunt — canonical-error mapping never echoes a raw provider body", () => {
  it("mapHttpStatusToConnectorError's ConnectorError.toData() never contains the marker", () => {
    const err = mapHttpStatusToConnectorError({
      status: 401,
      provider: "jira",
      rawProviderResponse: { apiToken: SECRET_MARKER, nested: { deeper: SECRET_MARKER } },
    });
    assertNoLeak("mapHttpStatusToConnectorError", err.toData());
    assertNoLeak("ConnectorError JSON.stringify", JSON.parse(JSON.stringify(err.toData())));
  });

  it("mapUnknownErrorToConnectorError's ConnectorError.toData() never contains the marker", () => {
    const err = mapUnknownErrorToConnectorError(
      ConnectorError.transient({
        message: "upstream failure",
        provider: "grafana",
        retryable: true,
        rawProviderResponse: { secretField: SECRET_MARKER },
      }),
      "grafana",
    );
    assertNoLeak("mapUnknownErrorToConnectorError", err.toData());
  });
});

describe("leak hunt — native tool-registry dispatch never echoes a raw provider body on error", () => {
  let journalDir: string;
  let journal: JournalStore;

  beforeEach(async () => {
    journalDir = await mkdtemp(join(tmpdir(), "eo-gateway-leak-hunt-"));
    journal = createJournalStore({ journalDir });
  });

  afterEach(async () => {
    await rm(journalDir, { recursive: true, force: true });
  });

  it("tracker.search's GatewayToolResult never contains the marker when the provider throws with it embedded", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const providers = new ProviderRegistry<GenericProviderClient>();
    const connection = await connections.create({
      provider: "leaky-provider",
      baseUrl: "https://example.invalid",
      allowedRedirectOrigins: [],
      allowedResources: [],
      allowedActions: [],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "X" },
    });
    providers.register("leaky-provider", {
      search: async () => {
        throw ConnectorError.permission({
          message: "forbidden",
          provider: "leaky-provider",
          retryable: false,
          rawProviderResponse: { errors: [{ token: SECRET_MARKER }] },
        });
      },
    });

    const registry = buildNativeToolRegistry({
      connections,
      providers,
      journal,
      mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
      supervisorSocketPath: "/nonexistent.sock",
    });
    const result = await registry.get("tracker.search")?.handler({ connectionId: connection.id, params: {} });
    assertNoLeak("tracker.search GatewayToolResult", result);
  });
});

describe("leak hunt — mutation pipeline never journals a raw provider body", () => {
  let journalDir: string;
  let journal: JournalStore;

  beforeEach(async () => {
    journalDir = await mkdtemp(join(tmpdir(), "eo-gateway-leak-hunt-pipeline-"));
    journal = createJournalStore({ journalDir });
  });

  afterEach(async () => {
    await rm(journalDir, { recursive: true, force: true });
  });

  it("a failed mutation's outcome, and every journal entry it wrote, never contain the marker", async () => {
    const plan = {
      schemaVersion: 1 as const,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      externalConnectionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      tenant: "tenant-a",
      canonicalTarget: "issue:EX-1",
      action: "transition",
      redactedDiff: "status: To Do -> In Progress",
      desiredStateHash: "sha256:leak-hunt-hash",
      idempotencyKey: "leak-hunt-op",
      impactClass: "reversible",
      rollbackClass: "version-checked-restore",
      envelopeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    };

    const sendRequest = async (): Promise<HttpTransportResponse> => ({
      status: 409,
      headers: {},
      bodyText: JSON.stringify({ conflictingToken: SECRET_MARKER }),
    });
    const httpClient = new GatewayHttpClient({
      allowlist: { allowedSchemes: ["https:"], allowedOrigins: ["https://leaky-provider.invalid"] },
      resolveHostAddresses: async () => ["203.0.113.7"],
      sendRequest,
    });

    const handlers: MutationPipelineHandlers = {
      provider: "leaky-provider",
      buildRequest: () => ({ url: new URL("https://leaky-provider.invalid/apply"), method: "PUT", hasPrecondition: true }),
      parseResponse: (_p, response) => JSON.parse(response.bodyText) as { appliedRevision: string },
      verify: async () => true,
    };

    const outcome = await executeMutationPlan(plan, handlers, {
      journal,
      httpClient,
      lock: new IdempotencyKeyLock(),
    });
    assertNoLeak("mutation pipeline outcome", outcome);

    const entries: unknown[] = [];
    for await (const entry of journal.queryEntries({ type: "remote_operation_record" })) {
      entries.push(entry);
    }
    assertNoLeak("every remote_operation_record journal entry", entries);
  });
});
