import { ConnectorError } from "@eo/contracts";
import type { GenericProviderClient, MutationApplyClient, ProviderRegistry } from "@eo/gateway";
import { JIRA_PROVIDER_NAME } from "../errors/jira-error-mapping.js";
import { createJiraMutationApplyClient } from "../resource-client/jira-mutation-apply-client.js";
import { createJiraProviderClient } from "../resource-client/jira-provider-client.js";
import { JiraConnectionRegistry } from "./jira-connection-registry.js";

/**
 * `../provider/register.ts` — the one call site that registers this
 * connector into `@eo/gateway`'s provider-dispatch point (roadmap/18
 * §Interfaces consumed: "this phase registers no MCP tool of its own" —
 * only a provider CLIENT, dispatched to by the gateway's already-
 * registered `tracker.*` tools). Every connection under
 * `JIRA_PROVIDER_NAME` is routed, at call time, to its own wiring via
 * `JiraConnectionRegistry` (see that module's doc comment for why a
 * synchronous per-connection lookup is required here).
 */
export { JIRA_PROVIDER_NAME };

function requireConnectionId(params: Record<string, unknown>): string {
  const connectionId = params["connectionId"];
  if (typeof connectionId !== "string" || connectionId.length === 0) {
    throw ConnectorError.validation({
      message: "params.connectionId is required for Jira tracker dispatch",
      provider: JIRA_PROVIDER_NAME,
      retryable: false,
    });
  }
  return connectionId;
}

function buildRoutedGenericProviderClient(registry: JiraConnectionRegistry): GenericProviderClient {
  const route = (params: Record<string, unknown>): GenericProviderClient =>
    createJiraProviderClient(registry.get(requireConnectionId(params)).resourceClient);

  return {
    search: async (params) => route(params).search?.(params),
    get: async (params) => route(params).get?.(params),
    planCreate: async (params) => route(params).planCreate?.(params),
    planUpdate: async (params) => route(params).planUpdate?.(params),
    planTransition: async (params) => route(params).planTransition?.(params),
    planComment: async (params) => route(params).planComment?.(params),
  };
}

function buildRoutedMutationApplyClient(registry: JiraConnectionRegistry): MutationApplyClient {
  return {
    buildRequest: (plan) =>
      createJiraMutationApplyClient(registry.get(plan.externalConnectionId).applyDeps).buildRequest(
        plan,
      ),
    parseResponse: (plan, response) =>
      createJiraMutationApplyClient(
        registry.get(plan.externalConnectionId).applyDeps,
      ).parseResponse(plan, response),
    verify: (plan, applied) =>
      createJiraMutationApplyClient(registry.get(plan.externalConnectionId).applyDeps).verify?.(
        plan,
        applied,
      ) ?? Promise.resolve(true),
    reconcileAmbiguous: (plan, cause) => {
      const client = createJiraMutationApplyClient(
        registry.get(plan.externalConnectionId).applyDeps,
      );
      return client.reconcileAmbiguous?.(plan, cause) ?? Promise.resolve(undefined);
    },
  };
}

export interface RegisterJiraCloudProviderDeps {
  readonly providers: ProviderRegistry<GenericProviderClient>;
  readonly mutationApplyClients: ProviderRegistry<MutationApplyClient>;
}

/**
 * Registers `JIRA_PROVIDER_NAME` into both of `@eo/gateway`'s provider
 * registries (the read/plan dispatch point and the mutation-apply
 * dispatch point), routed through a fresh `JiraConnectionRegistry`.
 * Callers use the returned registry's `register(connection, ...)` to
 * wire each `ExternalConnection` before any dispatch call for it can
 * succeed (a dispatch for an unregistered connection fails with
 * `JiraConnectionNotRegisteredError`, never a silent no-op).
 */
export function registerJiraCloudProvider(
  deps: RegisterJiraCloudProviderDeps,
): JiraConnectionRegistry {
  const registry = new JiraConnectionRegistry();
  deps.providers.register(JIRA_PROVIDER_NAME, buildRoutedGenericProviderClient(registry));
  deps.mutationApplyClients.register(JIRA_PROVIDER_NAME, buildRoutedMutationApplyClient(registry));
  return registry;
}

export type { JiraConnectionRegistry } from "./jira-connection-registry.js";
export { JiraConnectionNotRegisteredError } from "./jira-connection-registry.js";
export type {
  JiraConnectionEntry,
  RegisterJiraConnectionOptions,
} from "./jira-connection-registry.js";
