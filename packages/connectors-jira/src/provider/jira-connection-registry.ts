import { buildHttpClientForConnection, type GatewayHttpClient } from "@eo/gateway";
import type { ExternalConnection } from "@eo/contracts";
import { AttachmentStagingRegistry } from "../attachments/attachment-staging.js";
import { buildFieldMetadataIndex, type FieldMetadataIndex } from "../capability/field-metadata.js";
import { createJiraEntityPropertyMarkerReconciler } from "../reconciliation/entity-property-marker.js";
import type { JiraTokenManager } from "../auth/token-manager.js";
import type { JiraHttpContext } from "../resource-client/http-read-helper.js";
import { createJiraResourceClient } from "../resource-client/jira-resource-client.js";
import type { JiraMutationApplyDeps } from "../resource-client/jira-mutation-apply-client.js";
import { JiraPlanPayloadRegistry } from "../resource-client/plan-payload-registry.js";
import type { JiraResourceClient } from "../resource-client/types.js";

/**
 * Per-connection wiring cache — the seam that resolves the tension
 * between `@eo/gateway`'s single-instance-per-provider `ProviderRegistry`
 * (one `GenericProviderClient`/`MutationApplyClient` for the ENTIRE
 * `"jira-cloud"` provider key) and the fact that every Jira Cloud SITE is
 * its own `ExternalConnection`, with its own base URL/token
 * manager/field metadata. `register()` does the async setup work (HTTP
 * client construction, wiring dependent modules) exactly once per
 * connection; `get()` is a synchronous Map lookup — required because
 * `MutationApplyClient.buildRequest` is itself synchronous
 * (`@eo/gateway`'s own contract), so connection resolution cannot be
 * async at that call site. `../provider/register.ts` is the one caller
 * that builds the routed `GenericProviderClient`/`MutationApplyClient`
 * over this registry and hands them to `ProviderRegistry.register`.
 */
export class JiraConnectionNotRegisteredError extends Error {
  readonly connectionId: string;

  constructor(connectionId: string) {
    super(
      `Jira connection "${connectionId}" was never registered — call JiraConnectionRegistry.register() first`,
    );
    this.name = "JiraConnectionNotRegisteredError";
    this.connectionId = connectionId;
    Object.freeze(this);
  }
}

export interface JiraConnectionEntry {
  readonly ctx: JiraHttpContext;
  readonly resourceClient: JiraResourceClient;
  readonly applyDeps: JiraMutationApplyDeps;
  readonly fieldMetadataIndex: FieldMetadataIndex;
}

export interface RegisterJiraConnectionOptions {
  /** Test-only escape hatch — production omits this, defaulting to `@eo/gateway`'s `buildHttpClientForConnection` (real DNS/TLS/SSRF stack). */
  readonly buildHttpClient?: (connection: ExternalConnection) => Promise<GatewayHttpClient>;
  /** Refreshed periodically by the caller via `../capability/discovery.ts`'s `discoverJiraFieldMetadata`; defaults to empty (every custom-field write refused until discovery has run at least once — fail-closed, never silently permissive). */
  readonly fieldMetadataIndex?: FieldMetadataIndex;
}

export class JiraConnectionRegistry {
  readonly #entries = new Map<string, JiraConnectionEntry>();
  readonly #attachmentStaging = new AttachmentStagingRegistry();

  get attachmentStaging(): AttachmentStagingRegistry {
    return this.#attachmentStaging;
  }

  async register(
    connection: ExternalConnection,
    tokenManager: JiraTokenManager,
    options: RegisterJiraConnectionOptions = {},
  ): Promise<JiraConnectionEntry> {
    const httpClient = await (options.buildHttpClient ?? buildHttpClientForConnection)(connection);
    const ctx: JiraHttpContext = { connection, httpClient, tokenManager };
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const fieldMetadataIndex = options.fieldMetadataIndex ?? buildFieldMetadataIndex([]);

    const resourceClient = createJiraResourceClient({ ctx, fieldMetadataIndex, payloadRegistry });
    const applyDeps: JiraMutationApplyDeps = {
      ctx,
      payloadRegistry,
      attachmentStaging: this.#attachmentStaging,
      issueMarkerReconciler: createJiraEntityPropertyMarkerReconciler(ctx, "issue"),
      commentMarkerReconciler: (issueKey) =>
        createJiraEntityPropertyMarkerReconciler(ctx, "comment", issueKey),
    };

    const entry: JiraConnectionEntry = { ctx, resourceClient, applyDeps, fieldMetadataIndex };
    this.#entries.set(connection.id, entry);
    return entry;
  }

  /** Synchronous lookup — throws `JiraConnectionNotRegisteredError` if `register()` was never called for `connectionId`. */
  get(connectionId: string): JiraConnectionEntry {
    const entry = this.#entries.get(connectionId);
    if (entry === undefined) {
      throw new JiraConnectionNotRegisteredError(connectionId);
    }
    return entry;
  }

  isRegistered(connectionId: string): boolean {
    return this.#entries.has(connectionId);
  }
}
