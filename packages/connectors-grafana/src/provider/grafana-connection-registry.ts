import type { CapabilitySnapshot, ExternalConnection } from "@eo/contracts";
import type { MutationApplyClient } from "@eo/gateway";
import { createGrafanaProviderAdapter, type GrafanaProviderAdapter } from "../adapter.js";
import { decodeApiFamiliesToRouteTable, type RouteTable } from "../discovery/route-table.js";
import {
  createGrafanaMutationApplyClient,
  type GrafanaRawHttpResponse,
} from "../mutation/mutation-apply-client.js";
import type { GrafanaPlanPayloadStoreLike } from "../mutation/plan-payload-store.js";
import type { GrafanaRollbackSnapshotStoreLike } from "../mutation/snapshot-store.js";

/**
 * Per-connection wiring cache for Grafana — the exact counterpart to
 * `@eo/connectors-jira`'s `JiraConnectionRegistry`, and it exists for one
 * reason more than that one does.
 *
 * `@eo/gateway`'s `ProviderRegistry` holds ONE client per provider key
 * (`"grafana"`), while `createGrafanaProviderAdapter` fixes
 * `externalConnectionId`, `tenant` AND `envelopeId` at construction
 * (`../adapter.ts`). The first two are per-connection, so a
 * connection-keyed cache resolves them the same way Jira's does. The
 * third is NOT: `envelopeId` names 02's `AuthorizationEnvelope`, minted
 * per approved ChangeSet, so it is per-AUTHORIZATION and varies call to
 * call within one connection. A single long-lived adapter would stamp
 * every `RemoteMutationPlan` with whichever envelope was live at
 * construction — recording the wrong authorization for the mutation, not
 * merely an untidy default. `adapterFor(envelopeId)` is therefore a
 * per-call factory, and the envelope arrives from the caller exactly as
 * it already does for `tracker.plan_create`
 * (`@eo/connectors-jira`'s `jira-provider-client.ts` reads
 * `params["envelopeId"]`).
 *
 * `register()` is async (it resolves the connection's current
 * `CapabilitySnapshot` once, to pin the mutation client's route table);
 * `get()` is a SYNCHRONOUS map lookup, which is required rather than
 * preferred — `MutationApplyClient.buildRequest` is synchronous by
 * `@eo/gateway`'s own contract, so connection resolution cannot be async
 * at that call site.
 */
export class GrafanaConnectionNotRegisteredError extends Error {
  readonly connectionId: string;

  constructor(connectionId: string) {
    super(
      `Grafana connection "${connectionId}" was never registered — call GrafanaConnectionRegistry.register() first`,
    );
    this.name = "GrafanaConnectionNotRegisteredError";
    this.connectionId = connectionId;
    Object.freeze(this);
  }
}

export interface RegisterGrafanaConnectionOptions {
  /** 16's operation-journal tenant key for this connection. */
  readonly tenant: string;
  /** Resolves this connection's current `CapabilitySnapshot` — production wires `@eo/gateway`'s `CapabilitySnapshotCache`, which owns TTL/invalidation. */
  readonly getSnapshot: () => Promise<CapabilitySnapshot>;
  /** The connection-scoped sender the adapter's own reads go through. */
  readonly send: (spec: {
    readonly method: string;
    readonly path: string;
  }) => Promise<GrafanaRawHttpResponse>;
  /** GET-only sender for the apply client's read-back/verify calls — same SSRF-guarded transport as `send`. */
  readonly get: (path: string) => Promise<GrafanaRawHttpResponse>;
  /** Durable in production (`../mutation/file-backed-store.ts`), in-memory in tests. Shared by every envelope's adapter for this connection — `apply` must find a plan whichever envelope built it. */
  readonly payloadStore: GrafanaPlanPayloadStoreLike;
  readonly snapshotStore: GrafanaRollbackSnapshotStoreLike;
  /** `annotation` creates only — see `../mutation/mutation-apply-client.ts`. */
  readonly findAnnotationByTag?: (tag: string) => Promise<string | undefined>;
}

export interface GrafanaConnectionEntry {
  readonly connection: ExternalConnection;
  /**
   * Pinned at registration because `GrafanaMutationApplyClientDeps` takes
   * a fixed `routeTable` (a pre-existing shape constraint of phase 20's
   * apply client, not a decision made here). The ADAPTER re-resolves the
   * route table per call from `getSnapshot`, so a mid-life discovery
   * refresh still reaches reads and planning.
   */
  readonly routeTable: RouteTable;
  /** Builds the adapter for ONE authorization envelope. Cheap and pure — `createGrafanaProviderAdapter` performs no I/O. */
  adapterFor(envelopeId: string): GrafanaProviderAdapter;
  readonly mutationApplyClient: MutationApplyClient;
}

export class GrafanaConnectionRegistry {
  readonly #entries = new Map<string, GrafanaConnectionEntry>();

  async register(
    connection: ExternalConnection,
    options: RegisterGrafanaConnectionOptions,
  ): Promise<GrafanaConnectionEntry> {
    const snapshot = await options.getSnapshot();
    const routeTable = decodeApiFamiliesToRouteTable(snapshot.apiFamilies);

    const entry: GrafanaConnectionEntry = {
      connection,
      routeTable,
      adapterFor: (envelopeId) =>
        createGrafanaProviderAdapter({
          externalConnectionId: connection.id,
          tenant: options.tenant,
          envelopeId,
          getSnapshot: options.getSnapshot,
          send: options.send,
          payloadStore: options.payloadStore,
          snapshotStore: options.snapshotStore,
        }),
      mutationApplyClient: createGrafanaMutationApplyClient({
        baseUrl: connection.baseUrl,
        routeTable,
        payloadStore: options.payloadStore,
        snapshotStore: options.snapshotStore,
        get: options.get,
        ...(options.findAnnotationByTag !== undefined
          ? { findAnnotationByTag: options.findAnnotationByTag }
          : {}),
      }),
    };

    // Upsert, matching `JiraConnectionRegistry` — re-registering a
    // connection after a credential rotation or discovery refresh must
    // replace its wiring, never leave the stale entry live alongside it.
    this.#entries.set(connection.id, entry);
    return entry;
  }

  /** Synchronous lookup — throws `GrafanaConnectionNotRegisteredError` if `register()` was never called for `connectionId`. */
  get(connectionId: string): GrafanaConnectionEntry {
    const entry = this.#entries.get(connectionId);
    if (entry === undefined) {
      throw new GrafanaConnectionNotRegisteredError(connectionId);
    }
    return entry;
  }

  isRegistered(connectionId: string): boolean {
    return this.#entries.has(connectionId);
  }
}
