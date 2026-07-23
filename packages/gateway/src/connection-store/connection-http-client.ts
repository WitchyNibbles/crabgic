/**
 * Builds a `GatewayHttpClient` scoped to one stored `ExternalConnection` —
 * the shared factory the mutation-apply tool path (HIGH #2 adversarial-
 * review fix) uses so every mutating MCP tool call gets the SAME SSRF
 * guard / write-serializer / retry-ladder / budget stack a read call
 * would, keyed off the connection's own allowlist fields, never a bespoke
 * per-call shortcut.
 */

import { readFile } from "node:fs/promises";
import type { ExternalConnection } from "@eo/contracts";
import { GatewayHttpClient, type GatewayHttpClientOptions } from "../transport/http-client.js";

/** Reads the connection's custom CA PEM off disk, if one is configured. */
export async function resolveCustomCaPem(
  connection: ExternalConnection,
): Promise<string | undefined> {
  if (connection.customCaRef === undefined) return undefined;
  return readFile(connection.customCaRef.path, "utf8");
}

/** The SSRF allowlist for a connection: its own base origin plus every declared redirect origin — the SAME allowlist every hop (initial request or redirect) is checked against. */
export function buildAllowlistForConnection(
  connection: ExternalConnection,
): GatewayHttpClientOptions["allowlist"] {
  const origin = new URL(connection.baseUrl).origin;
  return {
    allowedSchemes: ["https:"],
    allowedOrigins: [origin, ...connection.allowedRedirectOrigins],
  };
}

/** Builds a `GatewayHttpClient` for `connection`, honoring its custom CA if configured. `overrides` is a test-only escape hatch (e.g. `sendRequest`/`resolveHostAddresses` fakes); production callers never need it. */
export async function buildHttpClientForConnection(
  connection: ExternalConnection,
  overrides: Partial<GatewayHttpClientOptions> = {},
): Promise<GatewayHttpClient> {
  const customCaPem = await resolveCustomCaPem(connection);
  return new GatewayHttpClient({
    allowlist: buildAllowlistForConnection(connection),
    ...(customCaPem !== undefined ? { customCaPem } : {}),
    ...overrides,
  });
}
