import { buildHttpClientForConnection, type GatewayHttpClient } from "@eo/gateway";
import type { ExternalConnection } from "@eo/contracts";
import { discoverJiraDatacenterCapabilitySnapshot } from "../capability/discovery-datacenter.js";
import {
  resolveDcEditionFeatures,
  type DcEditionEntry,
} from "../capability/dc-edition-feature-matrix.js";
import { buildFieldMetadataIndex, type FieldMetadataIndex } from "../capability/field-metadata.js";
import { createJiraDatacenterEntityPropertyMarkerReconciler } from "../reconciliation/entity-property-marker-dc.js";
import { resolveJiraDatacenterAuthHeaderProvider } from "../auth/jira-datacenter-auth.js";
import type { JiraDatacenterHttpContext } from "../resource-client/datacenter/jira-datacenter-http-context.js";
import { createJiraDatacenterResourceClient } from "../resource-client/datacenter/jira-datacenter-resource-client.js";
import type { JiraDatacenterMutationApplyDeps } from "../resource-client/datacenter/jira-mutation-apply-client-dc.js";
import { JiraPlanPayloadRegistry } from "../resource-client/plan-payload-registry.js";
import type { JiraResourceClient } from "../resource-client/types.js";
import type { JiraConnectionConfig } from "./jira-connection-config.js";
import { AttachmentStagingRegistry } from "../attachments/attachment-staging.js";

/**
 * Data Center equivalent of `./jira-connection-registry.ts` — the same
 * per-connection wiring-cache seam (see that module's doc comment for the
 * full synchronous-`get()`-vs-async-`register()` rationale, unchanged
 * here), built against `JiraConnectionConfig` (this phase's own
 * deployment/auth-mode discriminator) instead of a bare
 * `JiraTokenManager`. `register()` resolves the auth-header provider
 * (`../auth/jira-datacenter-auth.ts`'s `resolveJiraDatacenterAuthHeaderProvider`,
 * which runs `assertBasicAuthPermitted` FIRST) BEFORE ever calling
 * `buildHttpClient` — a disallowed basic-auth config never reaches
 * network-client construction, matching roadmap/19's "reject pre-network"
 * requirement even at this registration boundary, not only inside a
 * single resource-client call.
 */
export class JiraDatacenterConnectionNotRegisteredError extends Error {
  readonly connectionId: string;

  constructor(connectionId: string) {
    super(
      `Jira Data Center connection "${connectionId}" was never registered — call JiraDatacenterConnectionRegistry.register() first`,
    );
    this.name = "JiraDatacenterConnectionNotRegisteredError";
    this.connectionId = connectionId;
    Object.freeze(this);
  }
}

export interface JiraDatacenterConnectionEntry {
  readonly ctx: JiraDatacenterHttpContext;
  readonly resourceClient: JiraResourceClient;
  readonly applyDeps: JiraDatacenterMutationApplyDeps;
  readonly fieldMetadataIndex: FieldMetadataIndex;
}

export interface RegisterJiraDatacenterConnectionOptions {
  /** Test-only escape hatch — production omits this, defaulting to `@eo/gateway`'s `buildHttpClientForConnection` (real DNS/TLS/SSRF/custom-CA stack). */
  readonly buildHttpClient?: (connection: ExternalConnection) => Promise<GatewayHttpClient>;
  /** Refreshed periodically by the caller via `../capability/discovery-datacenter.ts`'s `discoverJiraDatacenterCapabilitySnapshot`; defaults to empty (every custom-field write refused until discovery has run at least once — fail-closed). */
  readonly fieldMetadataIndex?: FieldMetadataIndex;
  /** Skips the discovery round-trip in tests — production callers normally omit this and let `register()` discover it itself. */
  readonly skipDiscovery?: boolean;
  /** Test-only escape hatch: injects an already-resolved `DcEditionEntry` instead of running discovery at all (implies `skipDiscovery`). Production callers never set this — `register()` discovering it live is the only production path. */
  readonly dcFeaturesOverride?: DcEditionEntry;
}

export class JiraDatacenterConnectionRegistry {
  readonly #entries = new Map<string, JiraDatacenterConnectionEntry>();
  readonly #attachmentStaging = new AttachmentStagingRegistry();

  get attachmentStaging(): AttachmentStagingRegistry {
    return this.#attachmentStaging;
  }

  async register(
    connection: ExternalConnection,
    config: JiraConnectionConfig,
    options: RegisterJiraDatacenterConnectionOptions = {},
  ): Promise<JiraDatacenterConnectionEntry> {
    // Runs FIRST, synchronously inside `resolveJiraDatacenterAuthHeaderProvider`
    // (via `assertBasicAuthPermitted`) — a disallowed basic-auth config
    // throws here, before `buildHttpClient` is ever invoked.
    const authHeaderProvider = resolveJiraDatacenterAuthHeaderProvider(config);

    const httpClient = await (options.buildHttpClient ?? buildHttpClientForConnection)(connection);
    const ctx: JiraDatacenterHttpContext = { connection, httpClient, authHeaderProvider };
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const fieldMetadataIndex = options.fieldMetadataIndex ?? buildFieldMetadataIndex([]);

    const dcFeatures =
      options.dcFeaturesOverride ??
      (options.skipDiscovery
        ? undefined
        : await discoverJiraDatacenterCapabilitySnapshot(ctx)
            .then((snapshot) => resolveDcEditionFeatures(snapshot.edition))
            .catch(() => undefined));

    const resourceClient = createJiraDatacenterResourceClient({
      ctx,
      fieldMetadataIndex,
      payloadRegistry,
      ...(dcFeatures !== undefined ? { dcFeatures } : {}),
    });
    const applyDeps: JiraDatacenterMutationApplyDeps = {
      ctx,
      payloadRegistry,
      attachmentStaging: this.#attachmentStaging,
      issueMarkerReconciler: createJiraDatacenterEntityPropertyMarkerReconciler(ctx, "issue"),
      commentMarkerReconciler: (issueKey) =>
        createJiraDatacenterEntityPropertyMarkerReconciler(ctx, "comment", issueKey),
    };

    const entry: JiraDatacenterConnectionEntry = {
      ctx,
      resourceClient,
      applyDeps,
      fieldMetadataIndex,
    };
    this.#entries.set(connection.id, entry);
    return entry;
  }

  /** Synchronous lookup — throws `JiraDatacenterConnectionNotRegisteredError` if `register()` was never called for `connectionId`. */
  get(connectionId: string): JiraDatacenterConnectionEntry {
    const entry = this.#entries.get(connectionId);
    if (entry === undefined) {
      throw new JiraDatacenterConnectionNotRegisteredError(connectionId);
    }
    return entry;
  }

  isRegistered(connectionId: string): boolean {
    return this.#entries.has(connectionId);
  }
}
