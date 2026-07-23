/**
 * Provider-dispatch point — roadmap/16-gateway-core.md §In scope,
 * "Provider dispatch": "a provider-keyed extension point inside
 * `tracker.*`/`observability.*`... distinct from the MCP tool registry...
 * 18's `JiraResourceClient` and 20's `GrafanaProviderAdapter` register into
 * it, and adding a provider never adds a new tool name." Work item 5.
 *
 * Keyed on `ExternalConnection.provider` (an opaque, extensible string per
 * that schema's own doc comment — never a closed union here). Registering
 * a second client under an already-registered provider key is rejected —
 * mirroring the MCP tool registry's own duplicate-name rejection (see
 * `../mcp/tool-registry.ts`) — and resolving an unregistered provider is
 * refused BEFORE any network call is attempted.
 */

export class UnknownProviderError extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super(`provider-registry: no client registered for provider "${provider}"`);
    this.name = "UnknownProviderError";
    this.provider = provider;
    Object.freeze(this);
  }
}

export class DuplicateProviderError extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super(`provider-registry: a client is already registered for provider "${provider}"`);
    this.name = "DuplicateProviderError";
    this.provider = provider;
    Object.freeze(this);
  }
}

/**
 * A provider-keyed registry of arbitrary client instances (`TClient` is
 * intentionally generic — `tracker.*`'s resource-client shape differs from
 * `observability.*`'s, and 16 imposes no shared interface on either beyond
 * "resolved by provider string").
 */
export class ProviderRegistry<TClient> {
  readonly #clients = new Map<string, TClient>();

  register(provider: string, client: TClient): void {
    if (this.#clients.has(provider)) {
      throw new DuplicateProviderError(provider);
    }
    this.#clients.set(provider, client);
  }

  /** Resolves the client registered for `provider`. Throws `UnknownProviderError` before any caller can proceed to a network call for an unrecognized provider. */
  resolve(provider: string): TClient {
    const client = this.#clients.get(provider);
    if (client === undefined) {
      throw new UnknownProviderError(provider);
    }
    return client;
  }

  isRegistered(provider: string): boolean {
    return this.#clients.has(provider);
  }

  get registeredProviders(): readonly string[] {
    return [...this.#clients.keys()];
  }
}
