import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  CapabilitySnapshotSchema,
  ConnectorError,
  CURRENT_SCHEMA_VERSION,
  ExternalConnectionSchema,
  type CapabilitySnapshot,
  type ExternalConnection,
} from "@eo/contracts";
import { ProviderRegistry } from "@eo/gateway";
import type { GenericProviderClient, MutationApplyClient } from "@eo/gateway";
import {
  buildRouteTable,
  capabilityFlag,
  encodeRouteTableToApiFamilies,
} from "../discovery/route-table.js";
import { GRAFANA_RESOURCE_KINDS } from "../resource-kinds.js";
import { GrafanaPlanPayloadStore } from "../mutation/plan-payload-store.js";
import { GrafanaRollbackSnapshotStore } from "../mutation/snapshot-store.js";
import type { GrafanaRawHttpResponse } from "../mutation/mutation-apply-client.js";
import {
  GrafanaConnectionNotRegisteredError,
  GrafanaConnectionRegistry,
} from "./grafana-connection-registry.js";
import { registerRoutedGrafanaProvider } from "./register-grafana-routed.js";
import { GRAFANA_PROVIDER_NAME } from "../provider-registration.js";

/**
 * WP5 (2026-07-25). `createGrafanaProviderAdapter` fixes `baseUrl`,
 * `externalConnectionId`, `tenant` AND `envelopeId` at construction
 * (`../adapter.ts`'s `GrafanaProviderAdapterDeps`), while
 * `ProviderRegistry` holds exactly ONE client per provider key. The first
 * three are per-connection, but `envelopeId` is per-AUTHORIZATION — 02's
 * `AuthorizationEnvelope` is minted per approved ChangeSet, not per
 * connection — so a single long-lived adapter would stamp every plan any
 * caller ever makes with whichever envelope happened to be live when the
 * process booted. That is a correctness defect, not a tidiness one: the
 * envelope is the authorization a mutation is executed under.
 *
 * This registry is the fix, mirroring `@eo/connectors-jira`'s
 * `JiraConnectionRegistry` — async `register()` per connection, then a
 * SYNCHRONOUS `get()` (required: `MutationApplyClient.buildRequest` is
 * synchronous by contract) and a per-call `adapterFor(envelopeId)`.
 *
 * Written before either module exists — the required red state.
 */
const FULL_ROUTE_TABLE = buildRouteTable(
  new Set(GRAFANA_RESOURCE_KINDS.map((kind) => capabilityFlag(kind, "legacy"))),
);

const CONNECTION_ID = "00000000-0000-4000-8000-000000000102";
const ENVELOPE_A = "00000000-0000-4000-8000-0000000001aa";
const ENVELOPE_B = "00000000-0000-4000-8000-0000000001bb";

function connection(overrides: Partial<ExternalConnection> = {}): ExternalConnection {
  return ExternalConnectionSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: CONNECTION_ID,
    provider: GRAFANA_PROVIDER_NAME,
    baseUrl: "https://grafana.example.com",
    secretRef: { backend: "env", variable: "GRAFANA_TOKEN" },
    allowedRedirectOrigins: [],
    allowedResources: [...GRAFANA_RESOURCE_KINDS],
    allowedActions: ["list", "get", "create", "update"],
    discoveryTtlSeconds: 900,
    ...overrides,
  });
}

function writableSnapshot(): CapabilitySnapshot {
  return CapabilitySnapshotSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "00000000-0000-4000-8000-000000000101",
    externalConnectionId: CONNECTION_ID,
    product: "grafana",
    edition: "oss",
    version: "13.1.0",
    apiFamilies: encodeRouteTableToApiFamilies(FULL_ROUTE_TABLE),
    resources: [...GRAFANA_RESOURCE_KINDS],
    actions: ["list", "get", "create", "update"],
    permissions: ["read", "write"],
    isReadOnly: false,
    discoveredAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  });
}

function registrationOptions(
  send: (spec: { method: string; path: string }) => Promise<GrafanaRawHttpResponse> = async () => {
    throw new Error("send: not scripted");
  },
) {
  return {
    tenant: "tenant-1",
    getSnapshot: async () => writableSnapshot(),
    send,
    get: async (): Promise<GrafanaRawHttpResponse> => ({
      status: 200,
      headers: {},
      bodyText: "{}",
    }),
    payloadStore: new GrafanaPlanPayloadStore(),
    snapshotStore: new GrafanaRollbackSnapshotStore(),
  };
}

/** Returns the thrown value rather than asserting inside a `catch`, so a missing throw fails loudly instead of landing in the same handler. */
function captureUnregisteredError(): unknown {
  const registry = new GrafanaConnectionRegistry();
  try {
    registry.get(CONNECTION_ID);
    return undefined;
  } catch (err) {
    return err;
  }
}

describe("GrafanaConnectionRegistry", () => {
  it("get() throws GrafanaConnectionNotRegisteredError for an unregistered connection — never a silent no-op", () => {
    const registry = new GrafanaConnectionRegistry();
    expect(() => registry.get(CONNECTION_ID)).toThrow(GrafanaConnectionNotRegisteredError);
    expect(() => registry.get(CONNECTION_ID)).toThrow(/never registered/);
  });

  it("names the offending connection on the error, without leaking the connection's secret reference", () => {
    const err = captureUnregisteredError();
    expect(err).toBeInstanceOf(GrafanaConnectionNotRegisteredError);
    expect((err as GrafanaConnectionNotRegisteredError).connectionId).toBe(CONNECTION_ID);
    expect((err as Error).message).not.toContain("GRAFANA_TOKEN");
  });

  /**
   * ADVERSARIAL-REVIEW FIX (2026-07-26). Both of these were pinned by
   * nothing: rewriting `this.name` to `"Error"` and dropping
   * `Object.freeze(this)` each survived the whole suite. `name` is the
   * property a caller that cannot import the class branches on (it crosses
   * package and process boundaries where `instanceof` does not), and the
   * freeze is what stops a handler from rewriting `connectionId` on a
   * routing error before it is logged.
   */
  it("carries its own error name and is frozen — the two properties a caller relies on", () => {
    const err = captureUnregisteredError();
    expect((err as Error).name).toBe("GrafanaConnectionNotRegisteredError");
    expect(Object.isFrozen(err)).toBe(true);
  });

  it("isRegistered() reports false before and true after register()", async () => {
    const registry = new GrafanaConnectionRegistry();
    expect(registry.isRegistered(CONNECTION_ID)).toBe(false);
    await registry.register(connection(), registrationOptions());
    expect(registry.isRegistered(CONNECTION_ID)).toBe(true);
  });

  it("get() is SYNCHRONOUS after an async register() — buildRequest cannot await", async () => {
    const registry = new GrafanaConnectionRegistry();
    await registry.register(connection(), registrationOptions());
    const entry = registry.get(CONNECTION_ID);
    expect(entry.connection.id).toBe(CONNECTION_ID);
    expect(typeof entry.adapterFor).toBe("function");
  });

  /** The whole reason this registry exists. */
  it("adapterFor(envelopeId) stamps THAT envelope on the plan — two envelopes over one connection stay distinct", async () => {
    const registry = new GrafanaConnectionRegistry();
    await registry.register(connection(), registrationOptions());
    const entry = registry.get(CONNECTION_ID);

    const planA = await entry.adapterFor(ENVELOPE_A).planCreate("folder", { title: "A" }, "idem-a");
    const planB = await entry.adapterFor(ENVELOPE_B).planCreate("folder", { title: "B" }, "idem-b");

    expect(planA.envelopeId).toBe(ENVELOPE_A);
    expect(planB.envelopeId).toBe(ENVELOPE_B);
  });

  it("both envelopes' adapters share ONE per-connection payload store — apply must find either plan", async () => {
    const registry = new GrafanaConnectionRegistry();
    const options = registrationOptions();
    await registry.register(connection(), options);
    const entry = registry.get(CONNECTION_ID);

    const planA = await entry.adapterFor(ENVELOPE_A).planCreate("folder", { title: "A" }, "idem-a");
    const planB = await entry.adapterFor(ENVELOPE_B).planCreate("folder", { title: "B" }, "idem-b");

    expect(options.payloadStore.get(planA.id)?.input).toEqual({ title: "A" });
    expect(options.payloadStore.get(planB.id)?.input).toEqual({ title: "B" });
  });

  /**
   * TITLE CORRECTED (2026-07-26). This said "baseUrl and id" while
   * asserting neither baseUrl nor anything that could observe it: the
   * adapter never dialled a base URL at all (its reads go through the
   * injected `send`), and `GrafanaProviderAdapterDeps.baseUrl` was a dead
   * declared field — since removed. The connection's base URL IS
   * load-bearing one layer down, on the apply client, which the test below
   * pins.
   */
  it("stamps the connection's own id and tenant on every plan it builds", async () => {
    const registry = new GrafanaConnectionRegistry();
    await registry.register(connection(), registrationOptions());
    const plan = await registry
      .get(CONNECTION_ID)
      .adapterFor(ENVELOPE_A)
      .planCreate("folder", { title: "A" }, "idem-a");
    expect(plan.externalConnectionId).toBe(CONNECTION_ID);
    expect(plan.tenant).toBe("tenant-1");
  });

  /**
   * The genuinely load-bearing use of `connection.baseUrl`: the entry's
   * apply client is the thing that turns a plan into an outbound request,
   * so a connection whose base URL did not reach it would dial someone
   * else's Grafana. Asserted against the CONNECTION's own value, and
   * against a second connection with a different host, so a hardcoded
   * origin cannot satisfy it.
   */
  it("the per-connection apply client dials THIS connection's baseUrl, not a fixed one", async () => {
    const registry = new GrafanaConnectionRegistry();
    const other = connection({
      id: "00000000-0000-4000-8000-000000000103",
      baseUrl: "https://grafana.other.example.com",
    });
    await registry.register(connection(), registrationOptions());
    await registry.register(other, registrationOptions());

    const planHere = await registry
      .get(CONNECTION_ID)
      .adapterFor(ENVELOPE_A)
      .planCreate("folder", { title: "A" }, "idem-a");
    const planThere = await registry
      .get(other.id)
      .adapterFor(ENVELOPE_A)
      .planCreate("folder", { title: "A" }, "idem-a");

    expect(registry.get(CONNECTION_ID).mutationApplyClient.buildRequest(planHere).url.origin).toBe(
      new URL(connection().baseUrl).origin,
    );
    expect(registry.get(other.id).mutationApplyClient.buildRequest(planThere).url.origin).toBe(
      new URL(other.baseUrl).origin,
    );
  });

  /** The optional annotation-marker lookup is threaded into the apply client only when supplied — the conditional-spread branch. */
  it("threads an optional findAnnotationByTag through to the connection's apply client", async () => {
    const registry = new GrafanaConnectionRegistry();
    let asked: string | undefined;
    await registry.register(connection(), {
      ...registrationOptions(),
      findAnnotationByTag: async (tag) => {
        asked = tag;
        return "annot-9";
      },
    });
    const entry = registry.get(CONNECTION_ID);
    const plan = await entry
      .adapterFor(ENVELOPE_A)
      .planCreate("annotation", { text: "deploy", tags: [] }, "idem-annot");

    // An annotation create is the one kind whose reconciliation has to
    // find the remote object by marker tag rather than by uid.
    await entry.mutationApplyClient.reconcileAmbiguous?.(plan, "timeout");
    expect(asked).toBeDefined();
  });

  it("re-registering the same connection replaces the entry rather than accumulating two", async () => {
    const registry = new GrafanaConnectionRegistry();
    await registry.register(connection(), registrationOptions());
    const second = registrationOptions();
    await registry.register(connection(), { ...second, tenant: "tenant-2" });
    const plan = await registry
      .get(CONNECTION_ID)
      .adapterFor(ENVELOPE_A)
      .planCreate("folder", { title: "A" }, "idem-a");
    expect(plan.tenant).toBe("tenant-2");
  });
});

describe("registerRoutedGrafanaProvider", () => {
  function registries() {
    return {
      providers: new ProviderRegistry<GenericProviderClient>(),
      mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
    };
  }

  it("registers BOTH halves under the grafana provider key", () => {
    const deps = registries();
    registerRoutedGrafanaProvider(deps);
    expect(deps.providers.isRegistered(GRAFANA_PROVIDER_NAME)).toBe(true);
    expect(deps.mutationApplyClients.isRegistered(GRAFANA_PROVIDER_NAME)).toBe(true);
  });

  it("returns the registry callers wire each connection into", () => {
    const registry = registerRoutedGrafanaProvider(registries());
    expect(registry).toBeInstanceOf(GrafanaConnectionRegistry);
  });

  it("a dispatch for an UNREGISTERED connection fails with the typed error, not UnknownProviderError", async () => {
    const deps = registries();
    registerRoutedGrafanaProvider(deps);
    const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);
    await expect(
      client["search"]?.({ connectionId: CONNECTION_ID, resourceKind: "folder" }),
    ).rejects.toBeInstanceOf(GrafanaConnectionNotRegisteredError);
  });

  it("routes search to the registered connection's adapter", async () => {
    const deps = registries();
    const registry = registerRoutedGrafanaProvider(deps);
    await registry.register(
      connection(),
      registrationOptions(async () => ({
        status: 200,
        headers: {},
        bodyText: JSON.stringify([{ uid: "fold-1", title: "Team" }]),
      })),
    );
    const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);
    await expect(
      client["search"]?.({ connectionId: CONNECTION_ID, resourceKind: "folder" }),
    ).resolves.toEqual([{ externalId: "fold-1", title: "Team" }]);
  });

  it("routes get to the registered connection's adapter", async () => {
    const deps = registries();
    const registry = registerRoutedGrafanaProvider(deps);
    await registry.register(
      connection(),
      registrationOptions(async () => ({
        status: 200,
        headers: { etag: '"etag-1"' },
        bodyText: JSON.stringify({ title: "Team", parentUid: null }),
      })),
    );
    const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);
    await expect(
      client["get"]?.({
        connectionId: CONNECTION_ID,
        resourceKind: "folder",
        externalId: "fold-1",
      }),
    ).resolves.toMatchObject({ externalId: "fold-1", revision: "etag-1" });
  });

  it("routes plan_update with the CALLER'S envelopeId, and captures the rollback snapshot", async () => {
    const deps = registries();
    const registry = registerRoutedGrafanaProvider(deps);
    const options = registrationOptions(async () => ({
      status: 200,
      headers: { etag: '"etag-7"' },
      bodyText: JSON.stringify({ title: "Team", parentUid: null }),
    }));
    await registry.register(connection(), options);
    const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);

    const plan = (await client["planUpdate"]?.({
      connectionId: CONNECTION_ID,
      envelopeId: ENVELOPE_B,
      resourceKind: "folder",
      externalId: "fold-1",
      input: { title: "Renamed" },
      idempotencyKey: "idem-2",
    })) as { id: string; envelopeId: string; expectedRemoteRevision?: string };

    expect(plan.envelopeId).toBe(ENVELOPE_B);
    expect(plan.expectedRemoteRevision).toBe("etag-7");
    expect(options.snapshotStore.get(plan.id)?.revision).toBe("etag-7");
  });

  it("REFUSES a plan_update with no envelopeId, exactly as plan_create does", async () => {
    const deps = registries();
    const registry = registerRoutedGrafanaProvider(deps);
    await registry.register(connection(), registrationOptions());
    const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);
    const error = await client["planUpdate"]?.({
      connectionId: CONNECTION_ID,
      resourceKind: "folder",
      externalId: "fold-1",
      input: { title: "Renamed" },
      idempotencyKey: "idem-2",
    }).then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ZodError);
    expect((error as ZodError).issues.map((issue) => issue.path.join("."))).toContain("envelopeId");
  });

  it("routes plan_create with the CALLER'S envelopeId, exactly as tracker.plan_create already does", async () => {
    const deps = registries();
    const registry = registerRoutedGrafanaProvider(deps);
    await registry.register(connection(), registrationOptions());
    const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);
    const plan = (await client["planCreate"]?.({
      connectionId: CONNECTION_ID,
      envelopeId: ENVELOPE_B,
      resourceKind: "folder",
      input: { title: "Team" },
      idempotencyKey: "idem-1",
    })) as { envelopeId: string };
    expect(plan.envelopeId).toBe(ENVELOPE_B);
  });

  it("REFUSES a plan_create with no envelopeId rather than inventing one", async () => {
    const deps = registries();
    const registry = registerRoutedGrafanaProvider(deps);
    await registry.register(connection(), registrationOptions());
    const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);

    // Asserted on the FAILING FIELD, not merely "it threw". A bare
    // `rejects.toThrow()` here is self-cancelling: give `envelopeId` any
    // default and the plan builder's own `RemoteMutationPlanSchema` still
    // rejects the fabricated value downstream, so the test would stay
    // green while the refusal moved from "the caller must supply an
    // authorization" to "the invented authorization was malformed".
    const error = await client["planCreate"]?.({
      connectionId: CONNECTION_ID,
      resourceKind: "folder",
      input: { title: "Team" },
      idempotencyKey: "idem-1",
    }).then(
      () => undefined,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(ZodError);
    expect((error as ZodError).issues.map((issue) => issue.path.join("."))).toContain("envelopeId");
  });

  it("REFUSES a dispatch with no connectionId as a canonical ConnectorError, not a raw ZodError", async () => {
    const deps = registries();
    registerRoutedGrafanaProvider(deps);
    const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);
    // Asserted as the CANONICAL error type on purpose: zod would also
    // reject this bag, so a weaker "throws something mentioning
    // connectionId" assertion would pass even with the explicit guard
    // deleted.
    await expect(client["search"]?.({ resourceKind: "folder" })).rejects.toBeInstanceOf(
      ConnectorError,
    );
    await expect(client["search"]?.({ resourceKind: "folder" })).rejects.toMatchObject({
      kind: "validation",
      provider: GRAFANA_PROVIDER_NAME,
    });
  });

  /**
   * ADVERSARIAL-REVIEW FIX (2026-07-26). This test used to assert only
   * `.rejects.toThrow()`, which cannot tell a BOUNDARY refusal from a
   * downstream one — and a validator proved it: with `ResourceKindSchema`
   * relaxed from `z.enum(...)` to a bare string, the call reached the
   * adapter, ran the capability-snapshot lookup (a real cache/network call
   * in production) and threw a plain `Error` from `requireBasePath`, and
   * this test still passed. It now asserts the error TYPE and counts what
   * the connection's injected dependencies were actually asked to do, so
   * "before any dispatch" is measured rather than asserted in the title.
   */
  it("still validates the params bag — an unknown resourceKind is refused before ANY dispatch", async () => {
    const deps = registries();
    const registry = registerRoutedGrafanaProvider(deps);
    const dispatched: string[] = [];
    await registry.register(connection(), {
      ...registrationOptions(async (spec) => {
        dispatched.push(`send:${spec.path}`);
        return { status: 200, headers: {}, bodyText: "[]" };
      }),
      getSnapshot: async () => {
        dispatched.push("getSnapshot");
        return writableSnapshot();
      },
    });
    // `register()` resolves the snapshot once to pin the route table; that
    // is setup, not dispatch.
    dispatched.length = 0;

    const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);
    const error = await client["search"]!({
      connectionId: CONNECTION_ID,
      resourceKind: "wormhole",
    }).then(
      () => undefined,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(ZodError);
    expect((error as ZodError).issues.map((issue) => issue.path.join("."))).toContain(
      "resourceKind",
    );
    expect(dispatched, "the malformed call reached the adapter").toEqual([]);
  });

  it("query needs no connection registration at all — it is pure local post-processing", async () => {
    const deps = registries();
    registerRoutedGrafanaProvider(deps);
    const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);
    await expect(
      client["query"]?.({
        connectionId: CONNECTION_ID,
        timeRange: { from: "now-1h", to: "now" },
        rawRows: [{ a: 1 }],
      }),
    ).resolves.toBeDefined();
  });

  /** The query layer's own product rule is untouched by routing: an unbounded query is still refused. */
  it("query still refuses an unbounded time range after routing", async () => {
    const deps = registries();
    registerRoutedGrafanaProvider(deps);
    const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);
    await expect(
      client["query"]?.({ connectionId: CONNECTION_ID, rawRows: [{ a: 1 }] }),
    ).rejects.toThrow(/time range/);
  });

  it("the routed MutationApplyClient routes on plan.externalConnectionId", async () => {
    const deps = registries();
    const registry = registerRoutedGrafanaProvider(deps);
    await registry.register(connection(), registrationOptions());
    const applyClient = deps.mutationApplyClients.resolve(GRAFANA_PROVIDER_NAME);
    const plan = await registry
      .get(CONNECTION_ID)
      .adapterFor(ENVELOPE_A)
      .planCreate("folder", { title: "Team" }, "idem-1");
    const request = applyClient.buildRequest(plan);
    expect(request.url.toString()).toContain("grafana.example.com");
  });

  it("the routed MutationApplyClient throws the typed error for an unregistered connection", async () => {
    const deps = registries();
    const registry = registerRoutedGrafanaProvider(deps);
    await registry.register(connection(), registrationOptions());
    const applyClient = deps.mutationApplyClients.resolve(GRAFANA_PROVIDER_NAME);
    const plan = await registry
      .get(CONNECTION_ID)
      .adapterFor(ENVELOPE_A)
      .planCreate("folder", { title: "Team" }, "idem-1");
    expect(() =>
      applyClient.buildRequest({ ...plan, externalConnectionId: "never-registered" }),
    ).toThrow(GrafanaConnectionNotRegisteredError);
  });

  it("routes verify() and reconcileAmbiguous() through the same per-connection entry", async () => {
    const deps = registries();
    const registry = registerRoutedGrafanaProvider(deps);
    await registry.register(connection(), registrationOptions());
    const applyClient = deps.mutationApplyClients.resolve(GRAFANA_PROVIDER_NAME);
    const plan = await registry
      .get(CONNECTION_ID)
      .adapterFor(ENVELOPE_A)
      .planCreate("folder", { title: "Team" }, "idem-1");
    // The scripted `get` returns `{}` — a real read-back that simply does
    // not match, so `verify` answers false rather than throwing.
    await expect(applyClient.verify?.(plan, { appliedRevision: "1" })).resolves.toBe(false);
    await expect(applyClient.reconcileAmbiguous?.(plan, "timeout")).resolves.toBeDefined();
  });

  it("parseResponse routes through the entry too", async () => {
    const deps = registries();
    const registry = registerRoutedGrafanaProvider(deps);
    await registry.register(connection(), registrationOptions());
    const applyClient = deps.mutationApplyClients.resolve(GRAFANA_PROVIDER_NAME);
    const plan = await registry
      .get(CONNECTION_ID)
      .adapterFor(ENVELOPE_A)
      .planCreate("folder", { title: "Team" }, "idem-1");
    expect(
      applyClient.parseResponse(plan, {
        status: 200,
        headers: { etag: '"9"' },
        bodyText: "{}",
      }),
    ).toEqual({ appliedRevision: "9" });
  });
});
