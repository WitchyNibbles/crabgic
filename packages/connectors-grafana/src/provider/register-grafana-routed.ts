import { z } from "zod";
import { ConnectorError } from "@crabgic/contracts";
import type {
  GenericProviderClient,
  MutationApplyClient,
  ProviderRegistry,
} from "@crabgic/gateway";
import { resolveConnectionSecret } from "@crabgic/gateway";
import { GRAFANA_PROVIDER_NAME } from "../provider-registration.js";
import { GRAFANA_RESOURCE_KINDS } from "../resource-kinds.js";
import { processGrafanaQueryResult, type GrafanaQueryRow } from "../query/query-layer.js";
import { GrafanaConnectionRegistry } from "./grafana-connection-registry.js";

/**
 * The per-connection counterpart to `../provider-registration.ts`'s
 * `registerGrafanaProvider`.
 *
 * `registerGrafanaProvider` takes ONE already-constructed
 * `GrafanaProviderAdapter` and one `MutationApplyClient`, which is the
 * right shape when a caller owns a single connection and a single
 * authorization envelope (16's own wiring code, the fixture replays, the
 * security manifests — all of which still use it unchanged). It is
 * structurally unable to serve the shipped `gateway mcp` server, where
 * `ProviderRegistry` holds exactly one client for the whole `"grafana"`
 * key while every call carries its own `connectionId` and `envelopeId`.
 * This module is that routed registration — one-for-one with
 * `@crabgic/connectors-jira`'s `registerJiraCloudProvider`, down to returning
 * the registry the caller wires each connection into and failing with a
 * typed `…NotRegisteredError` rather than a silent no-op.
 *
 * Every params bag is schema-validated FIRST, keeping
 * `../provider-registration.ts`'s own boundary-validation rule: a
 * malformed `observability.*` call is rejected here, before it reaches an
 * adapter — the schemas below are those schemas plus the routing fields
 * the generic dispatch surface carries (`connectionId` for every leaf,
 * `envelopeId` for the two planning leaves), because
 * `@crabgic/gateway`'s `provider-dispatch-tool.ts` offers no other channel.
 */
const ResourceKindSchema = z.enum(GRAFANA_RESOURCE_KINDS);
const ConnectionIdSchema = z.string().min(1);

const ROUTED_SEARCH_SCHEMA = z
  .object({ connectionId: ConnectionIdSchema, resourceKind: ResourceKindSchema })
  .strict();
const ROUTED_GET_SCHEMA = z
  .object({
    connectionId: ConnectionIdSchema,
    resourceKind: ResourceKindSchema,
    externalId: z.string().min(1),
  })
  .strict();
const ROUTED_QUERY_SCHEMA = z
  .object({
    connectionId: ConnectionIdSchema,
    timeRange: z.object({ from: z.string(), to: z.string() }).optional(),
    fields: z.array(z.string()).optional(),
    rawRows: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();
const ROUTED_PLAN_CREATE_SCHEMA = z
  .object({
    connectionId: ConnectionIdSchema,
    // Required, never defaulted: the envelope IS the authorization a
    // mutation is planned under. Inventing one would fabricate an
    // approval.
    envelopeId: z.string().min(1),
    resourceKind: ResourceKindSchema,
    input: z.record(z.string(), z.unknown()),
    idempotencyKey: z.string().min(1),
  })
  .strict();
const ROUTED_PLAN_UPDATE_SCHEMA = z
  .object({
    connectionId: ConnectionIdSchema,
    envelopeId: z.string().min(1),
    resourceKind: ResourceKindSchema,
    externalId: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
    idempotencyKey: z.string().min(1),
  })
  .strict();

/**
 * The five routed leaves' schemas, exported as the module's BOUNDARY
 * CONTRACT rather than as an implementation detail.
 *
 * Exported because several of the guarantees above are unobservable
 * through dispatch and were therefore pinned by nothing:
 * `requireConnectionId` refuses an empty `connectionId` on every leaf
 * before the schema ever runs, masking `ConnectionIdSchema.min(1)`; and the
 * `query` leaf's strictness is invisible behind a call that otherwise
 * succeeds. A validator's mutation battery (2026-07-25) confirmed both —
 * dropping `.strict()` from all five and relaxing `ConnectionIdSchema` to a
 * bare `z.string()` left the whole suite green.
 *
 * A SECOND battery (2026-07-26) found the same class still open on the
 * fields a dispatch-level test cannot separate from a downstream failure:
 * relaxing `ResourceKindSchema` from an enum to a bare string let the call
 * reach the adapter and perform its capability-snapshot lookup while the
 * only test naming it (`.rejects.toThrow()`) stayed green, and dropping
 * `.min(1)` from `envelopeId`, `externalId` and `idempotencyKey` survived
 * outright — the existing cases covered the MISSING key, which zod's
 * required-field rule catches on its own, never the empty one. An empty
 * `envelopeId` is exactly the fabricated approval the comment above forbids.
 * `./register-grafana-routed.test.ts` asserts this record directly, on the
 * failing field and issue code, and separately asserts through dispatch
 * that a malformed bag leaves the connection's injected `getSnapshot`/`send`
 * untouched.
 */
export const ROUTED_OBSERVABILITY_SCHEMAS = {
  search: ROUTED_SEARCH_SCHEMA,
  get: ROUTED_GET_SCHEMA,
  query: ROUTED_QUERY_SCHEMA,
  planCreate: ROUTED_PLAN_CREATE_SCHEMA,
  planUpdate: ROUTED_PLAN_UPDATE_SCHEMA,
} as const;

/**
 * A params bag with no usable `connectionId` cannot be routed at all —
 * refused as a canonical `validation` error rather than resolved against
 * an arbitrary connection. `zod`'s own failure for the same field is
 * equally loud; this exists so the message names the routing field
 * explicitly for the schema-less `query` path too.
 */
function requireConnectionId(params: Record<string, unknown>): string {
  const connectionId = params["connectionId"];
  if (typeof connectionId !== "string" || connectionId.length === 0) {
    throw ConnectorError.validation({
      message: "params.connectionId is required for Grafana observability dispatch",
      provider: GRAFANA_PROVIDER_NAME,
      retryable: false,
    });
  }
  return connectionId;
}

function buildRoutedGenericProviderClient(
  registry: GrafanaConnectionRegistry,
): GenericProviderClient {
  return {
    search: async (params) => {
      requireConnectionId(params);
      const { connectionId, resourceKind } = ROUTED_SEARCH_SCHEMA.parse(params);
      // `adapterFor` needs an envelope only to STAMP plans; reads never
      // build one, so the read path deliberately does not demand an
      // envelopeId the caller has no reason to hold.
      return registry.get(connectionId).adapterFor(READ_ONLY_ENVELOPE).list(resourceKind);
    },
    get: async (params) => {
      requireConnectionId(params);
      const { connectionId, resourceKind, externalId } = ROUTED_GET_SCHEMA.parse(params);
      return registry
        .get(connectionId)
        .adapterFor(READ_ONLY_ENVELOPE)
        .get(resourceKind, externalId);
    },
    query: async (params) => {
      requireConnectionId(params);
      const { timeRange, fields, rawRows } = ROUTED_QUERY_SCHEMA.parse(params);
      // Deliberately does NOT resolve the connection: `processGrafanaQueryResult`
      // is pure local post-processing of rows the caller already holds
      // (scoping, redaction, downsampling) — the same behaviour
      // `../provider-registration.ts` has today. Requiring registration
      // here would refuse a call that touches no remote at all.
      return processGrafanaQueryResult({
        timeRange,
        ...(fields !== undefined ? { fields } : {}),
        rawRows: rawRows as readonly GrafanaQueryRow[],
      });
    },
    planCreate: async (params) => {
      requireConnectionId(params);
      const { connectionId, envelopeId, resourceKind, input, idempotencyKey } =
        ROUTED_PLAN_CREATE_SCHEMA.parse(params);
      return registry
        .get(connectionId)
        .adapterFor(envelopeId)
        .planCreate(resourceKind, input, idempotencyKey);
    },
    planUpdate: async (params) => {
      requireConnectionId(params);
      const { connectionId, envelopeId, resourceKind, externalId, input, idempotencyKey } =
        ROUTED_PLAN_UPDATE_SCHEMA.parse(params);
      return registry
        .get(connectionId)
        .adapterFor(envelopeId)
        .planUpdate(resourceKind, externalId, input, idempotencyKey);
    },
  };
}

/**
 * The envelope id a READ dispatch runs under. Reads build no
 * `RemoteMutationPlan`, so this value is never stamped on anything and
 * never reaches the remote; it exists only because
 * `GrafanaProviderAdapterDeps.envelopeId` is a required construction
 * field shared by the read and plan methods. It is a fixed, obviously
 * non-authorizing sentinel rather than a random UUID precisely so that a
 * future code path which DID stamp it would be immediately identifiable
 * in a journal rather than looking like a real envelope. Exported so that
 * forensic property is assertable: it is the LITERAL value that carries
 * it, and a mutation of the literal used to survive the whole suite.
 */
export const READ_ONLY_ENVELOPE = "grafana-read-no-envelope";

function buildRoutedMutationApplyClient(registry: GrafanaConnectionRegistry): MutationApplyClient {
  return {
    // Resolved per write from the connection's own secret reference, the
    // same credential its authenticated reads use. Grafana writes went out
    // bare until issue #135's defect 5: the apply path builds a request
    // that the GATEWAY sends, so it never passed through this connector's
    // own authenticated sender.
    authHeaders: async (plan) => ({
      authorization: `Bearer ${await resolveConnectionSecret(
        registry.get(plan.externalConnectionId).connection,
      )}`,
    }),
    buildRequest: (plan) =>
      registry.get(plan.externalConnectionId).mutationApplyClient.buildRequest(plan),
    parseResponse: (plan, response) =>
      registry.get(plan.externalConnectionId).mutationApplyClient.parseResponse(plan, response),
    verify: (plan, applied) =>
      registry.get(plan.externalConnectionId).mutationApplyClient.verify?.(plan, applied) ??
      Promise.resolve(true),
    reconcileAmbiguous: (plan, cause) =>
      registry
        .get(plan.externalConnectionId)
        .mutationApplyClient.reconcileAmbiguous?.(plan, cause) ?? Promise.resolve(undefined),
  };
}

export interface RegisterRoutedGrafanaProviderDeps {
  readonly providers: ProviderRegistry<GenericProviderClient>;
  readonly mutationApplyClients: ProviderRegistry<MutationApplyClient>;
}

/**
 * Registers `GRAFANA_PROVIDER_NAME` into both of `@crabgic/gateway`'s
 * provider-dispatch registries, routed through a fresh
 * `GrafanaConnectionRegistry`. Callers use the returned registry's
 * `register(connection, options)` to wire each `ExternalConnection`
 * before any dispatch for it can succeed; a dispatch for an unregistered
 * connection fails with `GrafanaConnectionNotRegisteredError`, never a
 * silent no-op and never the misleading `UnknownProviderError` an EMPTY
 * registry produced.
 */
export function registerRoutedGrafanaProvider(
  deps: RegisterRoutedGrafanaProviderDeps,
): GrafanaConnectionRegistry {
  const registry = new GrafanaConnectionRegistry();
  deps.providers.register(GRAFANA_PROVIDER_NAME, buildRoutedGenericProviderClient(registry));
  deps.mutationApplyClients.register(
    GRAFANA_PROVIDER_NAME,
    buildRoutedMutationApplyClient(registry),
  );
  return registry;
}
