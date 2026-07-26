import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  CapabilitySnapshotSchema,
  ConnectorError,
  CURRENT_SCHEMA_VERSION,
  ExternalConnectionSchema,
  type CapabilitySnapshot,
  type ExternalConnection,
} from "@crabgic/contracts";
import { ProviderRegistry } from "@crabgic/gateway";
import type { GenericProviderClient, MutationApplyClient } from "@crabgic/gateway";
import {
  buildRouteTable,
  capabilityFlag,
  encodeRouteTableToApiFamilies,
} from "../discovery/route-table.js";
import { GRAFANA_RESOURCE_KINDS } from "../resource-kinds.js";
import { GrafanaPlanPayloadStore } from "../mutation/plan-payload-store.js";
import { GrafanaRollbackSnapshotStore } from "../mutation/snapshot-store.js";
import type { GrafanaRawHttpResponse } from "../mutation/mutation-apply-client.js";
import { GRAFANA_PROVIDER_NAME } from "../provider-registration.js";
import type { GrafanaProviderAdapter } from "../adapter.js";
import {
  READ_ONLY_ENVELOPE,
  ROUTED_OBSERVABILITY_SCHEMAS,
  registerRoutedGrafanaProvider,
} from "./register-grafana-routed.js";

/**
 * ADVERSARIAL-REVIEW FIX (2026-07-25). `./grafana-connection-registry.test.ts`
 * proves the ROUTING behaviour; every assertion here instead pins the
 * BOUNDARY-VALIDATION guarantee this module's own header claims — "a
 * malformed `observability.*` call is rejected here, before it reaches an
 * adapter". A validator's mutation battery found that claim unenforced:
 * deleting `.strict()` from all five schemas, relaxing
 * `ConnectionIdSchema` to a bare `z.string()`, deleting the
 * `requireConnectionId` guard from the `query` leaf, and rewriting
 * `READ_ONLY_ENVELOPE`'s literal ALL survived the existing suite.
 *
 * The schema record is asserted directly as well as through dispatch,
 * because the two `connectionId` guards deliberately overlap: the explicit
 * `requireConnectionId` check masks `ConnectionIdSchema.min(1)` on every
 * leaf, so through dispatch alone the schema's own minimum can never be
 * observed and could be silently dropped.
 */
const FULL_ROUTE_TABLE = buildRouteTable(
  new Set(GRAFANA_RESOURCE_KINDS.map((kind) => capabilityFlag(kind, "legacy"))),
);

const CONNECTION_ID = "00000000-0000-4000-8000-000000000102";
const ENVELOPE_A = "00000000-0000-4000-8000-0000000001aa";

function connection(): ExternalConnection {
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

/** A list read parses an ARRAY body and a single-resource read parses an OBJECT one, so the scripted sender answers by path. */
function registrationOptions(
  send: (spec: { method: string; path: string }) => Promise<GrafanaRawHttpResponse> = async (
    spec,
  ) => ({
    status: 200,
    headers: { etag: '"etag-1"' },
    bodyText: spec.path.endsWith("/fold-1")
      ? JSON.stringify({ title: "Team", parentUid: null })
      : JSON.stringify([{ uid: "fold-1", title: "Team" }]),
  }),
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

function registries() {
  return {
    providers: new ProviderRegistry<GenericProviderClient>(),
    mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
  };
}

type RoutedLeaf = keyof typeof ROUTED_OBSERVABILITY_SCHEMAS;

/** One well-formed params bag per routed leaf — the baseline each malformed variant below perturbs by exactly one field. */
const VALID_PARAMS: Readonly<Record<RoutedLeaf, Record<string, unknown>>> = {
  search: { connectionId: CONNECTION_ID, resourceKind: "folder" },
  get: { connectionId: CONNECTION_ID, resourceKind: "folder", externalId: "fold-1" },
  query: {
    connectionId: CONNECTION_ID,
    timeRange: { from: "now-1h", to: "now" },
    rawRows: [{ a: 1 }],
  },
  planCreate: {
    connectionId: CONNECTION_ID,
    envelopeId: ENVELOPE_A,
    resourceKind: "folder",
    input: { title: "Team" },
    idempotencyKey: "idem-1",
  },
  planUpdate: {
    connectionId: CONNECTION_ID,
    envelopeId: ENVELOPE_A,
    resourceKind: "folder",
    externalId: "fold-1",
    input: { title: "Renamed" },
    idempotencyKey: "idem-2",
  },
};

const LEAVES = Object.keys(VALID_PARAMS) as readonly RoutedLeaf[];

/**
 * The leaves that carry a `resourceKind`. `query` is deliberately absent —
 * it post-processes rows the caller already holds and names no resource —
 * and the first test below derives this list from `VALID_PARAMS` so a leaf
 * that later GAINS a `resourceKind` cannot quietly escape the enum battery.
 */
const KIND_LEAVES = ["search", "get", "planCreate", "planUpdate"] as const;

/**
 * Every `.min(1)` guard on the boundary schemas, as `(leaf, field)` pairs.
 *
 * ADVERSARIAL-REVIEW FIX (2026-07-26). A validator's mutation battery
 * relaxed each of these to a bare `z.string()` and the whole suite stayed
 * green: the existing "REFUSES a plan_create/plan_update with no
 * envelopeId" tests cover only the MISSING key, which zod's required-field
 * rule catches on its own, so the EMPTINESS half was pinned by nothing.
 * That matters most for `envelopeId` — `./register-grafana-routed.ts`'s own
 * comment says the envelope IS the authorization and "inventing one would
 * fabricate an approval", and `""` is exactly such an invention.
 */
const NON_EMPTY_FIELDS: readonly (readonly [RoutedLeaf, string])[] = [
  ["get", "externalId"],
  ["planUpdate", "externalId"],
  ["planCreate", "envelopeId"],
  ["planUpdate", "envelopeId"],
  ["planCreate", "idempotencyKey"],
  ["planUpdate", "idempotencyKey"],
];

/** Returns the thrown value rather than asserting "it threw", so every case below can assert the FAILING FIELD. */
function captureParseError(leaf: RoutedLeaf, params: Record<string, unknown>): unknown {
  try {
    ROUTED_OBSERVABILITY_SCHEMAS[leaf].parse(params);
    return undefined;
  } catch (err) {
    return err;
  }
}

/** The single issue raised for `path`, or `undefined` — lets a case prove WHY the bag was refused. */
function issueAt(error: unknown, path: string) {
  return error instanceof ZodError
    ? error.issues.find((issue) => issue.path.join(".") === path)
    : undefined;
}

describe("routed observability schemas — the boundary contract, asserted directly", () => {
  it("covers exactly the five routed leaves the generic dispatch surface exposes", () => {
    expect(Object.keys(ROUTED_OBSERVABILITY_SCHEMAS).sort()).toEqual([...LEAVES].sort());
  });

  /** Keeps `KIND_LEAVES` honest: the enum battery below must cover every leaf that names a resource kind at all. */
  it("KIND_LEAVES is exactly the set of leaves whose params bag carries a resourceKind", () => {
    expect(LEAVES.filter((leaf) => "resourceKind" in VALID_PARAMS[leaf]).sort()).toEqual(
      [...KIND_LEAVES].sort(),
    );
  });

  it.each(LEAVES)("%s accepts its own well-formed params bag", (leaf) => {
    expect(() => ROUTED_OBSERVABILITY_SCHEMAS[leaf].parse(VALID_PARAMS[leaf])).not.toThrow();
  });

  /**
   * `.strict()` on all five, asserted as an UNRECOGNIZED-KEY issue rather
   * than as "it threw": every one of these bags is otherwise valid, so a
   * bare `toThrow()` would pass for the wrong reason if a required field
   * were later renamed.
   */
  it.each(LEAVES)("%s REJECTS an unknown extra key — the schemas are strict", (leaf) => {
    const error = captureParseError(leaf, {
      ...VALID_PARAMS[leaf],
      smuggledField: "unexpected",
    });

    expect(error, `${leaf} accepted an unknown key`).toBeInstanceOf(ZodError);
    expect((error as ZodError).issues.map((issue) => issue.code)).toContain("unrecognized_keys");
  });

  /**
   * `ConnectionIdSchema`'s own minimum. Unobservable through dispatch —
   * `requireConnectionId` refuses an empty string first on every leaf — so
   * this is the only place the schema-layer guard can be pinned at all.
   */
  it.each(LEAVES)("%s REFUSES an empty connectionId at the schema layer", (leaf) => {
    const error = captureParseError(leaf, { ...VALID_PARAMS[leaf], connectionId: "" });

    expect(error, `${leaf} accepted an empty connectionId`).toBeInstanceOf(ZodError);
    expect(issueAt(error, "connectionId")?.code, `${leaf} refused for the wrong reason`).toBe(
      "too_small",
    );
  });

  /**
   * `ResourceKindSchema` is a `z.enum(GRAFANA_RESOURCE_KINDS)`, and that is
   * the field most likely to be malformed on a real `observability.*` call.
   * ADVERSARIAL-REVIEW FIX (2026-07-26): relaxing it to a bare `z.string()`
   * survived the entire suite, because the only test that named it asserted
   * a bare `.rejects.toThrow()` through dispatch — which the ADAPTER also
   * satisfies, one capability-snapshot lookup later. Asserted here on the
   * ISSUE CODE at path `resourceKind`, so "it threw" cannot stand in for
   * "the enum refused it".
   */
  it.each(KIND_LEAVES)("%s REFUSES an out-of-enum resourceKind at the schema layer", (leaf) => {
    const error = captureParseError(leaf, { ...VALID_PARAMS[leaf], resourceKind: "wormhole" });

    expect(error, `${leaf} accepted an out-of-enum resourceKind`).toBeInstanceOf(ZodError);
    expect(issueAt(error, "resourceKind")?.code, `${leaf} refused for the wrong reason`).toMatch(
      /^invalid_(enum_value|value)$/,
    );
  });

  it.each(NON_EMPTY_FIELDS)(
    "%s REFUSES an EMPTY %s — the guard is .min(1), not presence",
    (leaf, field) => {
      const error = captureParseError(leaf, { ...VALID_PARAMS[leaf], [field]: "" });

      expect(error, `${leaf} accepted an empty ${field}`).toBeInstanceOf(ZodError);
      expect(issueAt(error, field)?.code, `${leaf} refused for the wrong reason`).toBe("too_small");
    },
  );
});

describe("registerRoutedGrafanaProvider — boundary validation through dispatch", () => {
  /**
   * The behavioural half of the strictness claim: with the connection
   * UNREGISTERED, a schema that let the extra key through would fall to
   * `GrafanaConnectionNotRegisteredError` (or, for `query`, would resolve),
   * so a `ZodError` here proves the rejection happened at the boundary and
   * never reached an adapter.
   */
  it.each(LEAVES)(
    "%s rejects an unknown extra key BEFORE resolving the connection",
    async (leaf) => {
      const deps = registries();
      registerRoutedGrafanaProvider(deps);
      const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);
      const error = await client[leaf]!({
        ...VALID_PARAMS[leaf],
        smuggledField: "unexpected",
      }).then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(error, `${leaf} did not reject the unknown key`).toBeInstanceOf(ZodError);
    },
  );

  /**
   * `requireConnectionId` on EVERY leaf, not just one.
   *
   * ADVERSARIAL-REVIEW FIX (2026-07-26). The guard converts a routing
   * failure into a canonical `ConnectorError.validation` that names
   * `params.connectionId`; zod would also refuse these bags, so only the
   * canonical ERROR TYPE distinguishes "the guard ran" from "zod caught it
   * downstream". A validator's battery deleted the guard from `get`,
   * `planCreate` and `planUpdate` with the whole repo green — the class had
   * been fixed on the `query` leaf alone. Both the missing-key and the
   * empty-string shape are driven, because `requireConnectionId` is the
   * only thing that rejects either one as a `ConnectorError`.
   */
  it.each(LEAVES)(
    "%s REFUSES a bag with NO connectionId as a canonical ConnectorError naming params.connectionId",
    async (leaf) => {
      const deps = registries();
      registerRoutedGrafanaProvider(deps);
      const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);
      const { connectionId: _omitted, ...withoutConnectionId } = VALID_PARAMS[leaf];
      const error = await client[leaf]!(withoutConnectionId).then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(error, `${leaf} did not raise the canonical guard error`).toBeInstanceOf(
        ConnectorError,
      );
      expect(error).toMatchObject({ kind: "validation", provider: GRAFANA_PROVIDER_NAME });
      expect((error as Error).message).toContain("params.connectionId");
    },
  );

  it.each(LEAVES)(
    "%s REFUSES an EMPTY connectionId as the same canonical ConnectorError, not a raw ZodError",
    async (leaf) => {
      const deps = registries();
      registerRoutedGrafanaProvider(deps);
      const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);
      const error = await client[leaf]!({ ...VALID_PARAMS[leaf], connectionId: "" }).then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(error, `${leaf} did not raise the canonical guard error`).toBeInstanceOf(
        ConnectorError,
      );
      expect(error).toMatchObject({ kind: "validation", provider: GRAFANA_PROVIDER_NAME });
      expect((error as Error).message).toContain("params.connectionId");
    },
  );
});

/**
 * The module header's central claim, asserted as an OBSERVATION rather than
 * as an error type: "a malformed `observability.*` call is rejected here,
 * before it reaches an adapter."
 *
 * ADVERSARIAL-REVIEW FIX (2026-07-26). `.rejects.toThrow()` cannot tell a
 * boundary refusal from a downstream one — with `ResourceKindSchema`
 * relaxed to a bare string the call reached the adapter, performed the
 * capability-snapshot lookup (a real cache/network call in production) and
 * threw a plain `Error` from `requireBasePath`, and the old test still
 * passed. These cases count what the connection's injected `getSnapshot`
 * and `send` were actually asked to do, so "nothing was dispatched" is
 * measured, not assumed.
 */
describe("registerRoutedGrafanaProvider — a malformed bag reaches NO adapter", () => {
  async function wiredWithDispatchCounter(): Promise<{
    readonly client: GenericProviderClient;
    readonly dispatched: string[];
  }> {
    const deps = registries();
    const registry = registerRoutedGrafanaProvider(deps);
    const dispatched: string[] = [];
    await registry.register(connection(), {
      ...registrationOptions(async (spec) => {
        dispatched.push(`send:${spec.method} ${spec.path}`);
        return { status: 200, headers: {}, bodyText: "[]" };
      }),
      getSnapshot: async () => {
        dispatched.push("getSnapshot");
        return writableSnapshot();
      },
    });

    const entry = registry.get(CONNECTION_ID);
    const realAdapterFor = entry.adapterFor.bind(entry);
    entry.adapterFor = (envelopeId: string): GrafanaProviderAdapter => {
      dispatched.push("adapterFor");
      return realAdapterFor(envelopeId);
    };

    // `register()` resolves the snapshot once to pin the route table. That
    // is setup, not dispatch — the counter starts here.
    dispatched.length = 0;
    return { client: deps.providers.resolve(GRAFANA_PROVIDER_NAME), dispatched };
  }

  it.each(KIND_LEAVES)(
    "%s with an out-of-enum resourceKind is a ZodError with NOTHING dispatched",
    async (leaf) => {
      const { client, dispatched } = await wiredWithDispatchCounter();
      const error = await client[leaf]!({
        ...VALID_PARAMS[leaf],
        resourceKind: "wormhole",
      }).then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(error, `${leaf} did not refuse the kind at the boundary`).toBeInstanceOf(ZodError);
      expect(dispatched, `${leaf} reached the adapter with an out-of-enum kind`).toEqual([]);
    },
  );

  it.each(["planCreate", "planUpdate"] as const)(
    "%s with an EMPTY envelopeId is a ZodError with NOTHING dispatched — no adapter is ever built",
    async (leaf) => {
      const { client, dispatched } = await wiredWithDispatchCounter();
      const error = await client[leaf]!({ ...VALID_PARAMS[leaf], envelopeId: "" }).then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(error, `${leaf} accepted an empty envelopeId`).toBeInstanceOf(ZodError);
      // Load-bearing: with `.min(1)` relaxed, the plan builder's own schema
      // may still refuse the fabricated envelope downstream — a ZodError
      // either way. Only the counter separates "refused before planning"
      // from "planned, then found malformed".
      expect(dispatched, `${leaf} built an adapter for an empty envelope`).toEqual([]);
    },
  );
});

describe("registerRoutedGrafanaProvider — optional-parameter and optional-method branches", () => {
  /** `fields` is the one query knob carried by a conditional spread, so its supplied branch needs its own case. */
  it("forwards an optional `fields` projection to the query layer", async () => {
    const deps = registries();
    registerRoutedGrafanaProvider(deps);
    const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);

    const scoped = (await client["query"]!({
      connectionId: CONNECTION_ID,
      timeRange: { from: "now-1h", to: "now" },
      fields: ["kept"],
      rawRows: [{ kept: 1, dropped: 2 }],
    })) as readonly Record<string, unknown>[];
    const unscoped = (await client["query"]!({
      connectionId: CONNECTION_ID,
      timeRange: { from: "now-1h", to: "now" },
      rawRows: [{ kept: 1, dropped: 2 }],
    })) as readonly Record<string, unknown>[];

    expect(Object.keys(scoped[0]!)).toEqual(["kept"]);
    expect(Object.keys(unscoped[0]!).sort()).toEqual(["dropped", "kept"]);
  });

  /**
   * `MutationApplyClient.verify` and `.reconcileAmbiguous` are OPTIONAL in
   * `@crabgic/gateway`'s own contract, while the mutation pipeline calls
   * `verify` unconditionally. The routed wrapper therefore has to supply
   * the same defaults the pipeline would otherwise be denied — "nothing to
   * read back, so do not block" and "no reconciliation available" — rather
   * than throwing on a legal per-connection client that omits them.
   */
  it("defaults verify/reconcileAmbiguous when the per-connection client omits them", async () => {
    const deps = registries();
    const registry = registerRoutedGrafanaProvider(deps);
    await registry.register(connection(), registrationOptions());
    const entry = registry.get(CONNECTION_ID);
    const plan = await entry.adapterFor(ENVELOPE_A).planCreate("folder", { title: "T" }, "idem-1");

    // A minimal, still-legal client: the two REQUIRED methods only.
    const full = entry.mutationApplyClient;
    (entry as { mutationApplyClient: MutationApplyClient }).mutationApplyClient = {
      buildRequest: (p) => full.buildRequest(p),
      parseResponse: (p, r) => full.parseResponse(p, r),
    };

    const applyClient = deps.mutationApplyClients.resolve(GRAFANA_PROVIDER_NAME);
    await expect(applyClient.verify?.(plan, { appliedRevision: "1" })).resolves.toBe(true);
    await expect(applyClient.reconcileAmbiguous?.(plan, "timeout")).resolves.toBeUndefined();
  });
});

describe("READ_ONLY_ENVELOPE", () => {
  /**
   * The constant's forensic rationale depends entirely on its literal
   * value: it is a fixed, obviously non-authorizing sentinel precisely so
   * that a future code path which DID stamp it would stand out in a
   * journal instead of looking like a real envelope. Both properties are
   * asserted — the exact literal, and that it could never be mistaken for
   * the UUID every genuine `AuthorizationEnvelope.id` is.
   */
  it("is the fixed, obviously non-authorizing sentinel — never a UUID-shaped value", () => {
    expect(READ_ONLY_ENVELOPE).toBe("grafana-read-no-envelope");
    expect(READ_ONLY_ENVELOPE).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  /** …and that it is the value the READ path actually hands to `adapterFor`, not merely an exported string. */
  it("is the envelope id a read dispatch builds its adapter with", async () => {
    const deps = registries();
    const registry = registerRoutedGrafanaProvider(deps);
    await registry.register(connection(), registrationOptions());

    // The entry is the live object the routed client resolves on every
    // call, so wrapping its factory observes the real dispatch rather than
    // a re-implementation of it.
    const entry = registry.get(CONNECTION_ID);
    const seen: string[] = [];
    const realAdapterFor = entry.adapterFor.bind(entry);
    entry.adapterFor = (envelopeId: string): GrafanaProviderAdapter => {
      seen.push(envelopeId);
      return realAdapterFor(envelopeId);
    };

    const client = deps.providers.resolve(GRAFANA_PROVIDER_NAME);
    await client["search"]!({ connectionId: CONNECTION_ID, resourceKind: "folder" });
    await client["get"]!({
      connectionId: CONNECTION_ID,
      resourceKind: "folder",
      externalId: "fold-1",
    });

    expect(seen).toEqual(["grafana-read-no-envelope", "grafana-read-no-envelope"]);
  });
});
