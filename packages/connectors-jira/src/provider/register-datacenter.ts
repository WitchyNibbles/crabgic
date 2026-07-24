import { ConnectorError } from "@eo/contracts";
import type { GenericProviderClient, MutationApplyClient, ProviderRegistry } from "@eo/gateway";
import { JIRA_DATACENTER_PROVIDER_NAME } from "../errors/jira-error-mapping.js";
import { createJiraDatacenterMutationApplyClient } from "../resource-client/datacenter/jira-mutation-apply-client-dc.js";
import { createJiraProviderClient } from "../resource-client/jira-provider-client.js";
import { JiraDatacenterConnectionRegistry } from "./jira-datacenter-connection-registry.js";

/**
 * `../provider/register-datacenter.ts` — the Data Center sibling of
 * `./register.ts`. **Provider-key split (reconciliation, roadmap/19's
 * carry-forward from 18's evidence doc):** 18 registers Cloud under the
 * literal provider key `"jira-cloud"` (`JIRA_PROVIDER_NAME`) and its own
 * `ConnectorError`s are attributed to that same string. This phase
 * registers Data Center under a SEPARATE key,
 * `JIRA_DATACENTER_PROVIDER_KEY = "jira-datacenter"`
 * (`JIRA_DATACENTER_PROVIDER_NAME`) — not the same key Cloud uses —
 * because:
 *
 *  1. `@eo/gateway`'s `ProviderRegistry` is a one-instance-per-key
 *     registry (`register()` throws `DuplicateProviderError` on a
 *     second registration under the same key) — a single shared key
 *     would require BOTH phases to coordinate registering into the exact
 *     same `JiraConnectionRegistry` instance, a coupling neither phase's
 *     own file currently expects or needs.
 *  2. Canonical-error attribution honesty: every `ConnectorError` this
 *     package throws carries a `provider` string
 *     (`ConnectorErrorData.provider`) that is meant to identify WHICH
 *     backend produced it — a Data Center failure attributed to
 *     `"jira-cloud"` would be actively misleading in redacted logs/
 *     evidence, undermining roadmap/19's own "canonical-error redaction
 *     confirmed on DC-specific error bodies" security requirement.
 *  3. Precedent: `packages/connectors-grafana`'s Cloud/OSS/Enterprise
 *     split uses ONE shared `"grafana"` key BUT resolves edition-specific
 *     routing entirely INSIDE its adapter (no separate provider-registry
 *     entry per edition) — Jira's situation differs because 18 already
 *     shipped a concrete, connection-registry-owning `registerJiraCloudProvider`
 *     with its own already-fixed `"jira-cloud"` key and its own fresh
 *     `JiraConnectionRegistry` instance per call; retrofitting that into a
 *     single shared key would mean editing 18's own `register.ts`, which
 *     this phase's constraints (§Constraints: "Do NOT ... break any
 *     phase-18 test") make the higher-risk path for zero behavioral gain.
 *
 * Both keys share the IDENTICAL `JiraResourceClient` contract
 * (`../resource-client/types.ts`) and the IDENTICAL dispatch adapters
 * (`createJiraProviderClient`, reused verbatim below — it is already
 * deployment-agnostic, operating only against the shared interface) —
 * only the registered KEY and the per-connection wiring differ. A caller
 * (16's `tracker.*` tool handlers) selects which key to dispatch to via
 * `ExternalConnection.provider` — `"jira-cloud"` for a Cloud connection,
 * `"jira-datacenter"` for a Data Center one — exactly the same mechanism
 * 16 already uses to route any other provider-keyed pair.
 */
export const JIRA_DATACENTER_PROVIDER_KEY = JIRA_DATACENTER_PROVIDER_NAME;

function requireConnectionId(params: Record<string, unknown>): string {
  const connectionId = params["connectionId"];
  if (typeof connectionId !== "string" || connectionId.length === 0) {
    throw ConnectorError.validation({
      message: "params.connectionId is required for Jira Data Center tracker dispatch",
      provider: JIRA_DATACENTER_PROVIDER_NAME,
      retryable: false,
    });
  }
  return connectionId;
}

function buildRoutedGenericProviderClient(
  registry: JiraDatacenterConnectionRegistry,
): GenericProviderClient {
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

function buildRoutedMutationApplyClient(
  registry: JiraDatacenterConnectionRegistry,
): MutationApplyClient {
  return {
    buildRequest: (plan) =>
      createJiraDatacenterMutationApplyClient(
        registry.get(plan.externalConnectionId).applyDeps,
      ).buildRequest(plan),
    parseResponse: (plan, response) =>
      createJiraDatacenterMutationApplyClient(
        registry.get(plan.externalConnectionId).applyDeps,
      ).parseResponse(plan, response),
    verify: (plan, applied) =>
      createJiraDatacenterMutationApplyClient(
        registry.get(plan.externalConnectionId).applyDeps,
      ).verify?.(plan, applied) ?? Promise.resolve(true),
    reconcileAmbiguous: (plan, cause) => {
      const client = createJiraDatacenterMutationApplyClient(
        registry.get(plan.externalConnectionId).applyDeps,
      );
      return client.reconcileAmbiguous?.(plan, cause) ?? Promise.resolve(undefined);
    },
  };
}

export interface RegisterJiraDatacenterProviderDeps {
  readonly providers: ProviderRegistry<GenericProviderClient>;
  readonly mutationApplyClients: ProviderRegistry<MutationApplyClient>;
}

/**
 * Registers `JIRA_DATACENTER_PROVIDER_KEY` into both of `@eo/gateway`'s
 * provider registries, routed through a fresh `JiraDatacenterConnectionRegistry`
 * — the exact same registration shape `./register.ts`'s
 * `registerJiraCloudProvider` uses for Cloud, under the separate DC key
 * (see this module's own doc comment for why two keys, not one).
 */
export function registerJiraDatacenterProvider(
  deps: RegisterJiraDatacenterProviderDeps,
): JiraDatacenterConnectionRegistry {
  const registry = new JiraDatacenterConnectionRegistry();
  deps.providers.register(JIRA_DATACENTER_PROVIDER_KEY, buildRoutedGenericProviderClient(registry));
  deps.mutationApplyClients.register(
    JIRA_DATACENTER_PROVIDER_KEY,
    buildRoutedMutationApplyClient(registry),
  );
  return registry;
}

export type { JiraDatacenterConnectionRegistry } from "./jira-datacenter-connection-registry.js";
export { JiraDatacenterConnectionNotRegisteredError } from "./jira-datacenter-connection-registry.js";
export type {
  JiraDatacenterConnectionEntry,
  RegisterJiraDatacenterConnectionOptions,
} from "./jira-datacenter-connection-registry.js";
