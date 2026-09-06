/**
 * Builds a `GatewayHttpClient` scoped to one stored `ExternalConnection` —
 * the shared factory the mutation-apply tool path (HIGH #2 adversarial-
 * review fix) uses so every mutating MCP tool call gets the SAME SSRF
 * guard / write-serializer / retry-ladder / budget stack a read call
 * would, keyed off the connection's own allowlist fields, never a bespoke
 * per-call shortcut.
 *
 * SAME FACTORY IS NOT SAME STACK, and the difference was a defect. Two of
 * those controls are per-CLIENT-INSTANCE state, not per-connection: the
 * `WriteSerializer` behind "write serialization per tenant+resource" and the
 * `ConcurrencyGate` behind "<=4 in-flight per connection"
 * (`../transport/http-client.ts`). This factory caches nothing, so a caller
 * that built a client per CALL gave every call its own empty mutex table and
 * its own gate: two concurrent `tracker.apply` writes to one issue contended
 * on nothing. `ConnectionHttpClientCache` below is how such a caller gets one
 * client per connection — which is what the read path has always had, since
 * `@crabgic/cli`'s `connection-activation.ts` registers one client per
 * connection at activation.
 */

import { readFile } from "node:fs/promises";
import type { ExternalConnection } from "@crabgic/contracts";
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

/** How a connection's client is built — `buildHttpClientForConnection` in production, a fake in tests. */
export type BuildHttpClientForConnection = (
  connection: ExternalConnection,
) => Promise<GatewayHttpClient>;

/**
 * One `GatewayHttpClient` per connection.
 *
 * The mutate path reaches its factory once per tool CALL, unlike the read path
 * which reaches it once per connection — see the header for what that made
 * inert. `../mcp/native-registry.ts` owns the single instance, beside the
 * single `IdempotencyKeyLock`, for the same reason.
 *
 * The map holds the PENDING promise, never the awaited client: two concurrent
 * first callers for one connection must be handed the SAME client, and caching
 * only after the await would build one each — the very shape being fixed.
 *
 * Keyed on the connection's identity AND the fields the client is derived
 * from, so a connection edited in place (a new base URL, a rotated CA path)
 * gets a new client rather than a stale one.
 *
 * A failed build is not cached: a connection whose custom CA was momentarily
 * unreadable must be retryable, not poisoned for the life of the process.
 */
export class ConnectionHttpClientCache {
  readonly #build: BuildHttpClientForConnection;
  readonly #byKey = new Map<string, Promise<GatewayHttpClient>>();

  constructor(build: BuildHttpClientForConnection = (c) => buildHttpClientForConnection(c)) {
    this.#build = build;
  }

  get(connection: ExternalConnection): Promise<GatewayHttpClient> {
    const key = cacheKeyFor(connection);
    const existing = this.#byKey.get(key);
    if (existing !== undefined) return existing;

    const pending = this.#build(connection);
    this.#byKey.set(key, pending);
    return pending.catch((err: unknown) => {
      // Only evict what THIS call installed: a later successful build for the
      // same key must not be dropped by an older failure settling late.
      if (this.#byKey.get(key) === pending) this.#byKey.delete(key);
      throw err;
    });
  }

  /** Distinct clients currently held — test/observability helper. */
  get size(): number {
    return this.#byKey.size;
  }
}

function cacheKeyFor(connection: ExternalConnection): string {
  return JSON.stringify([
    connection.id,
    connection.baseUrl,
    [...connection.allowedRedirectOrigins],
    connection.customCaRef?.path,
  ]);
}
