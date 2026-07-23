/**
 * Fake tracker provider double — roadmap/16-gateway-core.md work item 6:
 * "scriptable tracker... doubles." A `GenericProviderClient` (the same
 * shape `ProviderRegistry<GenericProviderClient>` resolves for real
 * `tracker.*` dispatch) built over `GatewayHttpClient`, wired to a fake
 * transport — exercised through this phase's real SSRF/retry/backoff/
 * budget stack, never a bespoke shortcut. 18 ("Jira Cloud") extends this
 * directly per this phase's own §Interfaces produced text.
 */

import { GatewayHttpClient } from "../transport/http-client.js";
import type { GenericProviderClient } from "../mcp/native-tools/provider-dispatch-tool.js";
import { createFakeProviderTransport, type FakeProviderScript } from "./fake-provider-transport.js";

export interface FakeTrackerProviderHandle {
  readonly client: GenericProviderClient;
  readonly calls: readonly { readonly method: string; readonly url: string }[];
}

const FAKE_TRACKER_BASE_URL = "https://fake-tracker.invalid";

/** Builds a fake `tracker.*` provider client driven by `script` — one scripted HTTP call per dispatched operation. */
export function createFakeTrackerProvider(script: FakeProviderScript): FakeTrackerProviderHandle {
  const fakeTransport = createFakeProviderTransport(script);
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [FAKE_TRACKER_BASE_URL] },
    sendRequest: fakeTransport.send,
    resolveHostAddresses: async () => ["203.0.113.7"],
    sleep: async () => undefined,
  });

  async function callAndParse(method: "GET" | "POST" | "PUT" | "PATCH", path: string, isWrite: boolean): Promise<unknown> {
    const response = await httpClient.request({
      connectionId: "fake-tracker-connection",
      tenant: "fake-tenant",
      resource: path,
      url: new URL(path, FAKE_TRACKER_BASE_URL),
      method,
      isWrite,
    });
    return JSON.parse(response.bodyText.length > 0 ? response.bodyText : "{}");
  }

  const client: GenericProviderClient = {
    search: async () => callAndParse("GET", "/search", false),
    get: async () => callAndParse("GET", "/item", false),
    planCreate: async () => callAndParse("GET", "/plan/create", false), // planning is local-only; no network call in the real implementation
    planUpdate: async () => callAndParse("GET", "/plan/update", false),
    planTransition: async () => callAndParse("GET", "/plan/transition", false),
    planComment: async () => callAndParse("GET", "/plan/comment", false),
    apply: async () => callAndParse("PUT", "/apply", true),
  };

  return { client, calls: fakeTransport.calls };
}
