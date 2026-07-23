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
import { ConnectorError } from "@eo/contracts";
import type { ExternalConnectionRepository } from "../../connection-store/external-connection-store.js";
import { ProviderRegistry, UnknownProviderError } from "../../provider-dispatch/provider-registry.js";
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
