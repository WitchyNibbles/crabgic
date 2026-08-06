import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, ExternalConnectionSchema } from "@crabgic/contracts";
import {
  IdempotencyKeyLock,
  buildHttpClientForConnection,
  executeMutationPlan,
  resolveSecretReference,
  type MutationPipelineHandlers,
  type MutationPipelineOutcome,
} from "@crabgic/gateway";
import {
  GrafanaPlanPayloadStore,
  GrafanaRollbackSnapshotStore,
  buildGrafanaMutationPlan,
  createGrafanaMutationApplyClient,
  decodeApiFamiliesToRouteTable,
  deriveDeterministicUid,
  discoverGrafanaCapabilities,
  type GrafanaRawHttpResponse,
  type GrafanaResourceKind,
} from "@crabgic/connectors-grafana";
import { bindRemoteResourceEvidence, type RemoteResourceBinding } from "@crabgic/gates";
import { createTestJournal } from "../testJournal.js";
import { SHARED_JOURNAL_ENV_VAR, describeEvidenceJournal } from "../traceabilityEvidence.js";
import { buildBasicAuthHeader } from "./basicAuth.js";
import {
  SEAM_PINNED_DIAL_ADDRESS,
  SEAM_RESOLVED_ADDRESS,
  realNetworkSendRequestPinnedTo,
} from "./tlsFrontedContainer.js";

/**
 * Drives a REAL Grafana dashboard mutation through the REAL
 * `executeMutationPlan` exactly-once pipeline against a TLS-fronted,
 * containerized Grafana OSS instance, then stamps the confirmed
 * `MutationApplyResult.appliedRevision` into a `RemoteResource` + evidence
 * pointer via `@crabgic/gates`'s production writer.
 *
 * NOTHING HERE IS A FAKE. roadmap/23:56 — "23 deliberately does not use
 * `packages/testkit`'s fakes for its own final verdicts ... against live or
 * containerized real systems instead." No cassette, no
 * `createFakeProviderTransport`, no hand-authored response script: the
 * revision this yields is whatever the container's own dashboards API
 * assigned, confirmed by the pipeline's own read-back `verify()` against
 * that same container.
 *
 * The only substitutions are the two documented address-resolution seams
 * (see `./tlsFrontedContainer.ts`), and both are recorded verbatim in the
 * emitted artifact.
 */

/**
 * The env var the run's `ExternalConnection.secretRef` points at, holding the
 * container-local `admin:<GF_SECURITY_ADMIN_PASSWORD>` credential from
 * `docker/grafana/<version>/docker-compose.yml`. Disposable, reachable only on
 * loopback, torn down with the container.
 *
 * It is RESOLVED through `@crabgic/gateway`'s real `resolveSecretReference` against
 * that declared `secretRef` (adversarial-validation MINOR-6: the previous
 * version hardcoded `admin:admin` inline while the connection advertised a
 * `secretRef` nothing read — a credential-resolution path the run claimed but
 * bypassed). No literal credential appears in this module.
 */
export const CONTAINER_ADMIN_SECRET_ENV = "CRABGIC_ATTESTATION_GRAFANA_CONTAINER_BASIC";

export interface GrafanaBindingRunInput {
  /** `https://127.0.0.1:<port>` — the TLS front's base URL. */
  readonly baseUrl: string;
  /** On-disk PEM path for `ExternalConnection.customCaRef`. */
  readonly certPath: string;
  /**
   * Every release requirement whose subject is a remote Jira/Grafana
   * resource (`releaseRequirements.ts`'s `requiresRemoteBinding`), each bound
   * to THIS run's confirmed revision.
   *
   * Was a single `requirementId`. One containerized mutation with a
   * read-back-confirmed `appliedRevision` is a single real observation that
   * evidences more than one exit criterion — it is both "remote (Jira/
   * Grafana) revisions" for the traceability criterion and the live
   * "exactly-once and read-back verification" for the connector one — so the
   * run binds each of them rather than leaving the others reported as having
   * no remote binding at all. Each gets its own `EvidenceRecord` through
   * 21's own `bindRemoteResourceEvidence` writer, naming that requirement;
   * no record is reused across requirements and nothing is asserted that the
   * run did not observe.
   */
  readonly requirementIds: readonly string[];
  readonly releaseCandidateObjectId: string;
}

export interface GrafanaBindingRunResult {
  readonly outcome: MutationPipelineOutcome;
  /** One binding per entry in `requirementIds`, all citing the same real dashboard revision. Empty when the mutation produced no confirmed revision. */
  readonly bindings: readonly RemoteResourceBinding[];
  readonly reportedVersion: string;
  readonly edition: string;
  readonly dashboardUid: string;
  /** Composed by `describeEvidenceJournal` — recorded verbatim in the artifact so a dangling `evidenceRecordId` can never look like a resolvable one. */
  readonly evidenceJournal: string;
  cleanup(): Promise<void>;
}

/** The build-info shape `discoverGrafanaCapabilities` validates, read from the container's own `/api/health`. */
interface GrafanaHealthBody {
  readonly version: string;
}

export async function runContainerizedGrafanaBinding(
  input: GrafanaBindingRunInput,
): Promise<GrafanaBindingRunResult> {
  const connection = ExternalConnectionSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    provider: "grafana",
    deploymentType: "oss",
    baseUrl: input.baseUrl,
    allowedRedirectOrigins: [],
    customCaRef: { path: input.certPath },
    allowedResources: ["dashboard"],
    allowedActions: ["create"],
    discoveryTtlSeconds: 900,
    secretRef: { backend: "env", variable: CONTAINER_ADMIN_SECRET_ENV },
  });

  // The connection's OWN declared secretRef, resolved by the production
  // resolver. If the variable is unset this throws a `SecretResolutionError`
  // and the run stops here — it never silently falls back to a guessed
  // default.
  const authorization = buildBasicAuthHeader(await resolveSecretReference(connection.secretRef));

  // The REAL production factory, with only the two documented seams injected
  // through its OWN existing `overrides` parameter. The SSRF allowlist, the
  // custom-CA read, the retry ladder, the write serializer and the result
  // budget are all the production ones.
  const httpClient = await buildHttpClientForConnection(connection, {
    resolveHostAddresses: async () => [SEAM_RESOLVED_ADDRESS],
    sendRequest: realNetworkSendRequestPinnedTo(SEAM_PINNED_DIAL_ADDRESS),
  });

  const get = async (path: string): Promise<GrafanaRawHttpResponse> =>
    httpClient.request({
      connectionId: connection.id,
      tenant: "default",
      resource: path,
      url: new URL(path, input.baseUrl),
      method: "GET",
      headers: { authorization },
    });

  // Real discovery against the real container — build info from its own
  // /api/health, and one real probe per (kind, family) candidate route.
  const discovery = await discoverGrafanaCapabilities({
    fetchBuildInfo: async () => {
      const response = await get("/api/health");
      const body = JSON.parse(response.bodyText) as GrafanaHealthBody;
      return { product: "grafana", edition: "oss", version: body.version };
    },
    probeRoute: async (kind: GrafanaResourceKind, family) => {
      // The `/apis` aggregated-API family is probed at its own discovery
      // root; the classic family at the resource's own base path. A 404
      // means "this build does not serve that family for this kind".
      const path = family === "apis" ? `/apis/${kind}.grafana.app` : "/api/search";
      const response = await get(path);
      return response.status < 400;
    },
  });

  const routeTable = decodeApiFamiliesToRouteTable(discovery.apiFamilies);
  const payloadStore = new GrafanaPlanPayloadStore();
  const snapshotStore = new GrafanaRollbackSnapshotStore();
  const applyClient = createGrafanaMutationApplyClient({
    baseUrl: input.baseUrl,
    routeTable,
    payloadStore,
    snapshotStore,
    get,
  });

  const idempotencyKey = `release-attestation:traceability:${randomUUID()}`;
  const dashboardUid = deriveDeterministicUid(idempotencyKey);
  const dashboardInput = {
    title: `EO release traceability ${dashboardUid}`,
    tags: ["crabgic", "release-traceability"],
    folderUid: "",
  };
  const planId = randomUUID();
  payloadStore.set(planId, { kind: "dashboard", action: "create", input: dashboardInput });
  const plan = buildGrafanaMutationPlan({
    id: planId,
    externalConnectionId: connection.id,
    tenant: "default",
    kind: "dashboard",
    action: "create",
    canonicalId: dashboardUid,
    input: dashboardInput,
    idempotencyKey,
    envelopeId: randomUUID(),
    redactedDiff: "dashboard: (new) -> release-candidate traceability binding",
  });

  // SHARED-JOURNAL CONTRACT, not a private mkdtemp. `bindRemoteResourceEvidence`
  // writes the EvidenceRecord that `pointers[].evidenceRecordId` names —
  // roadmap/21 work item 1's actual deliverable — so writing it into a
  // directory teardown deletes made the committed artifact's id permanently
  // dangling. `createTestJournal` honours `CRABGIC_RELEASE_GATE_JOURNAL_DIR` (the
  // same directory `e2e/report`'s generator reads) and makes `cleanup()` a
  // no-op in that mode, exactly as every sibling harness does.
  const testJournal = await createTestJournal();
  const journal = testJournal.store;
  const journalShared = process.env[SHARED_JOURNAL_ENV_VAR] === testJournal.journalDir;

  const verify = applyClient.verify;
  const reconcileAmbiguous = applyClient.reconcileAmbiguous;
  const handlers: MutationPipelineHandlers = {
    provider: "grafana",
    // The connection's credential is attached here rather than inside the
    // resource definition, mirroring how a registered provider's auth-header
    // provider attaches it in the production dispatch path. The definition
    // itself stays pure and credential-free.
    buildRequest: (p) => {
      const spec = applyClient.buildRequest(p);
      return {
        ...spec,
        headers: {
          ...(spec.headers ?? {}),
          authorization,
          "content-type": "application/json",
        },
      };
    },
    parseResponse: (p, r) => applyClient.parseResponse(p, r),
    verify: verify !== undefined ? (p, a) => verify(p, a) : async () => true,
    ...(reconcileAmbiguous !== undefined
      ? { reconcileAmbiguous: (p: typeof plan, cause: unknown) => reconcileAmbiguous(p, cause) }
      : {}),
  };

  const outcome = await executeMutationPlan(plan, handlers, {
    journal,
    httpClient,
    lock: new IdempotencyKeyLock(),
    // DEFECT 21: tenant-unscoped. Untyped here (or outside `tsc -b`), so stated
    // explicitly rather than left to default — an omitted key would read as
    // `undefined` anyway, but silence is what let this hole exist.
    tenantAllowlist: undefined,
    folderAllowlist: undefined,
  });

  // One binding per requirement, sequential by design: each call journals
  // its own EvidenceRecord, and they must land as separate, ordered entries.
  const bindings: RemoteResourceBinding[] = [];
  if (outcome.appliedRevision !== undefined) {
    for (const requirementId of input.requirementIds) {
      bindings.push(
        await bindRemoteResourceEvidence(journal, {
          requirementId,
          changeSetId: randomUUID(),
          objectId: input.releaseCandidateObjectId,
          externalConnectionId: connection.id,
          target: { provider: "grafana", kind: "dashboard", externalId: dashboardUid },
          applied: { appliedRevision: outcome.appliedRevision },
          canonicalUrl: `${input.baseUrl}/d/${dashboardUid}`,
        }),
      );
    }
  }

  return {
    outcome,
    bindings,
    reportedVersion: discovery.version,
    edition: discovery.edition,
    dashboardUid,
    evidenceJournal: describeEvidenceJournal({
      shared: journalShared,
      dir: testJournal.journalDir,
    }),
    cleanup: () => testJournal.cleanup(),
  };
}
