/**
 * Fake observability provider double — roadmap/16-gateway-core.md work
 * item 6: "scriptable... observability doubles." Mirrors
 * `./fake-tracker-provider.js`'s design exactly (a `GenericProviderClient`
 * over `GatewayHttpClient`, wired to a fake transport). 20 ("Grafana")
 * extends this independently per this phase's own §Interfaces produced
 * text.
 */

import { GatewayHttpClient } from "../transport/http-client.js";
import type { GenericProviderClient } from "../mcp/native-tools/provider-dispatch-tool.js";
import { createFakeProviderTransport, type FakeProviderScript } from "./fake-provider-transport.js";

export interface FakeObservabilityProviderHandle {
  readonly client: GenericProviderClient;
  readonly calls: readonly { readonly method: string; readonly url: string }[];
}

const FAKE_OBSERVABILITY_BASE_URL = "https://fake-observability.invalid";

export function createFakeObservabilityProvider(
  script: FakeProviderScript,
): FakeObservabilityProviderHandle {
  const fakeTransport = createFakeProviderTransport(script);
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [FAKE_OBSERVABILITY_BASE_URL] },
    sendRequest: fakeTransport.send,
    resolveHostAddresses: async () => ["203.0.113.7"],
    sleep: async () => undefined,
  });

  async function callAndParse(
    method: "GET" | "POST" | "PUT" | "PATCH",
    path: string,
    isWrite: boolean,
  ): Promise<unknown> {
    const response = await httpClient.request({
      connectionId: "fake-observability-connection",
      tenant: "fake-tenant",
      resource: path,
      url: new URL(path, FAKE_OBSERVABILITY_BASE_URL),
      method,
      isWrite,
    });
    return JSON.parse(response.bodyText.length > 0 ? response.bodyText : "{}");
  }

  const client: GenericProviderClient = {
    search: async () => callAndParse("GET", "/search", false),
    get: async () => callAndParse("GET", "/item", false),
    query: async () => callAndParse("GET", "/query", false),
    planCreate: async () => callAndParse("GET", "/plan/create", false),
    planUpdate: async () => callAndParse("GET", "/plan/update", false),
    apply: async () => callAndParse("PUT", "/apply", true),
  };

  return { client, calls: fakeTransport.calls };
}
