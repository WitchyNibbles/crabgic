/**
 * Generic provider-dispatch MCP tool factory — backs every `tracker.*`/
 * `observability.*` native tool (roadmap/16-gateway-core.md §In scope,
 * "Sole MCP host & extensible tool-registration API"). Resolves the
 * caller-supplied `connectionId` to its `ExternalConnection`, dispatches
 * to the provider-keyed client registered for `connection.provider` (the
 * provider-dispatch point, `../../provider-dispatch/provider-registry.js`
 * — distinct from this MCP tool registry itself), and enforces the 256
 * KiB result budget on every response, never leaking a raw provider body
 * on error (canonical-error mapping).
 */

import { z } from "zod";
import { ConnectorError, type ExternalConnection } from "@crabgic/contracts";
import type { ExternalConnectionRepository } from "../../connection-store/external-connection-store.js";
import {
  ProviderRegistry,
  UnknownProviderError,
} from "../../provider-dispatch/provider-registry.js";
import { BudgetExceededError, enforceResultBudget } from "../../transport/budgets.js";
import { mapUnknownErrorToConnectorError } from "../../mutation-pipeline/error-mapping.js";
import type { GatewayToolDefinition, GatewayToolResult } from "../tool-registry.js";

/** A provider client exposes one async method per dispatchable operation, keyed by the tool's leaf operation name (e.g. `search`, `planCreate`). 18/20 implement this against their own resource clients. */
export type GenericProviderClient = Record<
  string,
  ((params: Record<string, unknown>) => Promise<unknown>) | undefined
>;

export interface ProviderDispatchDeps {
  readonly connections: ExternalConnectionRepository;
  readonly providers: ProviderRegistry<GenericProviderClient>;
  /**
   * Prepares a connection's per-connection wiring before it is dispatched
   * to — idempotent, and called on EVERY dispatch so the first call for a
   * connection wires it and later ones are a cheap no-op.
   *
   * WHY IT EXISTS (issue #135, defect 3). Each connector keeps a
   * per-connection registry behind its single provider-keyed client
   * (`JiraConnectionRegistry`, `GrafanaConnectionRegistry`), because one
   * provider key serves many sites. NOTHING EVER CALLED `register()` on
   * either: the registries were created at boot, returned, and dropped.
   * So `registry.get(connectionId)` threw for every connection that ever
   * existed — "was never registered" — and no connector could serve a
   * single request. The provider clients resolved fine; the lookup behind
   * them was permanently empty.
   *
   * Activation is LAZY rather than a boot-time sweep: it needs resolved
   * credentials and (for Grafana) a live capability snapshot, so doing it
   * for every stored connection at boot would turn one unreachable host
   * into a gateway that will not start.
   *
   * Optional here because `@crabgic/gateway` must stay provider-agnostic
   * — the composition root owns the activator, since it is the only layer
   * that knows both the registries and the connectors. When absent,
   * dispatch behaves exactly as before.
   */
  readonly activateConnection?: (connection: ExternalConnection) => Promise<void>;
}

const PROVIDER_DISPATCH_INPUT_SHAPE = {
  connectionId: z.string(),
  params: z.record(z.string(), z.unknown()),
};

function errorResult(err: ConnectorError): GatewayToolResult {
  return { content: [{ type: "text", text: JSON.stringify(err.toData()) }], isError: true };
}

/** Builds one `tracker.*`/`observability.*` native tool, dispatched to `operation` on the resolved provider client. */
export function buildProviderDispatchTool(
  name: string,
  description: string,
  operation: string,
  deps: ProviderDispatchDeps,
): GatewayToolDefinition<typeof PROVIDER_DISPATCH_INPUT_SHAPE> {
  return {
    name,
    description,
    inputSchema: PROVIDER_DISPATCH_INPUT_SHAPE,
    handler: async (args) => {
      const connection = await deps.connections.get(args.connectionId);
      if (connection === undefined) {
        return errorResult(
          ConnectorError.notFound({
            message: `no such connection: ${args.connectionId}`,
            provider: "unknown",
            retryable: false,
          }),
        );
      }

      // Before the client is resolved: a failure here is a wiring or
      // credential problem for THIS connection, and reporting it as such
      // beats the "was never registered" the routed client would throw
      // several frames later.
      if (deps.activateConnection !== undefined) {
        try {
          await deps.activateConnection(connection);
        } catch (err) {
          return errorResult(mapUnknownErrorToConnectorError(err, connection.provider));
        }
      }

      let client: GenericProviderClient;
      try {
        client = deps.providers.resolve(connection.provider);
      } catch (err) {
        if (err instanceof UnknownProviderError) {
          return errorResult(
            ConnectorError.unsupported({
              message: err.message,
              provider: connection.provider,
              retryable: false,
            }),
          );
        }
        throw err;
      }

      const method = client[operation];
      if (method === undefined) {
        return errorResult(
          ConnectorError.unsupported({
            message: `provider "${connection.provider}" does not implement operation "${operation}"`,
            provider: connection.provider,
            retryable: false,
          }),
        );
      }

      try {
        const result = await method(args.params);
        const text = JSON.stringify(result);
        enforceResultBudget(text);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          return errorResult(
            ConnectorError.validation({
              message: err.message,
              provider: connection.provider,
              retryable: false,
            }),
          );
        }
        return errorResult(mapUnknownErrorToConnectorError(err, connection.provider));
      }
    },
  };
}
