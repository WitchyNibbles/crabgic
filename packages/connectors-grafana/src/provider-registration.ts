import { z } from "zod";
import type { GenericProviderClient, MutationApplyClient, ProviderRegistry } from "@eo/gateway";
import { GRAFANA_RESOURCE_KINDS } from "./resource-kinds.js";
import type { GrafanaProviderAdapter } from "./adapter.js";
import { processGrafanaQueryResult, type GrafanaQueryRow } from "./query/query-layer.js";

/**
 * Registers a Grafana `GrafanaProviderAdapter` + its `MutationApplyClient`
 * into `@eo/gateway`'s provider-dispatch registries — roadmap/20 §Interfaces
 * produced: "registers into 16's provider-dispatch point for the
 * `observability.*` tool family." Every param object crossing this boundary
 * is schema-validated FIRST (coding-style: "validate at system
 * boundaries") — a malformed `observability.*` tool call is rejected here,
 * before it ever reaches the adapter.
 */
export const GRAFANA_PROVIDER_NAME = "grafana";

const ResourceKindSchema = z.enum(GRAFANA_RESOURCE_KINDS);

const SEARCH_PARAMS_SCHEMA = z.object({ resourceKind: ResourceKindSchema }).strict();
const GET_PARAMS_SCHEMA = z
  .object({ resourceKind: ResourceKindSchema, externalId: z.string().min(1) })
  .strict();
const PLAN_CREATE_PARAMS_SCHEMA = z
  .object({
    resourceKind: ResourceKindSchema,
    input: z.record(z.string(), z.unknown()),
    idempotencyKey: z.string().min(1),
  })
  .strict();
const PLAN_UPDATE_PARAMS_SCHEMA = z
  .object({
    resourceKind: ResourceKindSchema,
    externalId: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
    idempotencyKey: z.string().min(1),
  })
  .strict();
const QUERY_PARAMS_SCHEMA = z
  .object({
    timeRange: z.object({ from: z.string(), to: z.string() }).optional(),
    fields: z.array(z.string()).optional(),
    rawRows: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();

/** Bridges a `GrafanaProviderAdapter` into `@eo/gateway`'s `GenericProviderClient` shape — the read/plan half of provider dispatch (`observability.search/get/query/plan_create/plan_update`). `observability.apply` is wired separately via the connector's own `MutationApplyClient` (`./mutation/mutation-apply-client.js`), per the SAME split `tracker.*`/`observability.*` already use in `@eo/gateway`. */
export function buildGrafanaGenericProviderClient(
  adapter: GrafanaProviderAdapter,
): GenericProviderClient {
  return {
    search: async (params) => {
      const { resourceKind } = SEARCH_PARAMS_SCHEMA.parse(params);
      return adapter.list(resourceKind);
    },
    get: async (params) => {
      const { resourceKind, externalId } = GET_PARAMS_SCHEMA.parse(params);
      return adapter.get(resourceKind, externalId);
    },
    query: async (params) => {
      const { timeRange, fields, rawRows } = QUERY_PARAMS_SCHEMA.parse(params);
      return processGrafanaQueryResult({
        timeRange,
        ...(fields !== undefined ? { fields } : {}),
        rawRows: rawRows as readonly GrafanaQueryRow[],
      });
    },
    planCreate: async (params) => {
      const { resourceKind, input, idempotencyKey } = PLAN_CREATE_PARAMS_SCHEMA.parse(params);
      return adapter.planCreate(resourceKind, input, idempotencyKey);
    },
    planUpdate: async (params) => {
      const { resourceKind, externalId, input, idempotencyKey } =
        PLAN_UPDATE_PARAMS_SCHEMA.parse(params);
      return adapter.planUpdate(resourceKind, externalId, input, idempotencyKey);
    },
  };
}

export interface RegisterGrafanaProviderDeps {
  readonly providers: ProviderRegistry<GenericProviderClient>;
  readonly mutationApplyClients: ProviderRegistry<MutationApplyClient>;
  readonly adapter: GrafanaProviderAdapter;
  readonly mutationApplyClient: MutationApplyClient;
}

/** Registers both halves of Grafana's provider dispatch under the SAME provider key — a caller (16's own wiring code, or 09/11's registration bootstrap) never registers one half without the other. */
export function registerGrafanaProvider(deps: RegisterGrafanaProviderDeps): void {
  deps.providers.register(GRAFANA_PROVIDER_NAME, buildGrafanaGenericProviderClient(deps.adapter));
  deps.mutationApplyClients.register(GRAFANA_PROVIDER_NAME, deps.mutationApplyClient);
}
