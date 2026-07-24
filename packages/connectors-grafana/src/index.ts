/**
 * `@eo/connectors-grafana` public barrel — roadmap/20-grafana-adapters.md
 * §Interfaces produced. Every cross-cutting surface this phase produces is
 * exported from exactly this module; downstream phases (21, 23) import
 * from `@eo/connectors-grafana` directly.
 */

// ---- Resource kinds + high-impact-flag table ----
export {
  GRAFANA_RESOURCE_KINDS,
  GRAFANA_HIGH_IMPACT_FLAGS,
  HIGH_IMPACT_FLAG_BY_KIND,
  isGrafanaResourceKind,
} from "./resource-kinds.js";
export type { GrafanaResourceKind } from "./resource-kinds.js";

// ---- Auth + connection-doctor (work item 1) ----
export { checkGrafanaConnectionDoctor } from "./auth/connection-doctor.js";
export type {
  GrafanaDoctorDeps,
  GrafanaDoctorResult,
  GrafanaTokenInfoResponse,
} from "./auth/connection-doctor.js";

// ---- Discovery / version-aware routing (work item 2) ----
export {
  BUILD_INFO_CLOUD_CURRENT,
  BUILD_INFO_ENTERPRISE_CURRENT,
  BUILD_INFO_OSS_11_6,
  BUILD_INFO_OSS_12_4,
  BUILD_INFO_OSS_13_1,
  BUILD_INFO_UNKNOWN,
  PINNED_BUILD_INFO_FIXTURES,
} from "./discovery/build-info-fixtures.js";
export type {
  GrafanaBuildInfoFixture,
  GrafanaBuildInfoResponse,
  GrafanaRouteFamily,
  RouteAvailability,
} from "./discovery/build-info-fixtures.js";
export {
  buildRouteTable,
  capabilityFlag,
  decodeApiFamiliesToRouteTable,
  encodeRouteTableToApiFamilies,
  selectRouteFamily,
} from "./discovery/route-table.js";
export type { CapabilityFlagSet, RouteTable, RouteTableEntry } from "./discovery/route-table.js";
export {
  buildGrafanaCapabilitySnapshotDiscoverer,
  discoverGrafanaCapabilities,
  isKnownGrafanaBuild,
} from "./discovery/capability-discovery.js";
export type {
  GrafanaDiscoveryDeps,
  GrafanaDiscoveryResult,
} from "./discovery/capability-discovery.js";

// ---- Resource clients + canonical serializers (work item 3) ----
export { canonicalFieldsEqual, hashCanonicalFields } from "./resources/resource-definitions.js";
export type {
  GrafanaHttpRequestSpec,
  GrafanaParsedResource,
  GrafanaResourceDefinition,
  GrafanaResourceSummary,
} from "./resources/resource-definitions.js";
export {
  GRAFANA_RESOURCE_DEFINITIONS,
  getResourceDefinition,
} from "./resources/definitions/index.js";
export { toGatewayHttpRequest } from "./resources/transport-bridge.js";
export type { BridgedHttpRequest } from "./resources/transport-bridge.js";

// ---- GrafanaProviderAdapter (roadmap/20's named interface) ----
export { createGrafanaProviderAdapter } from "./adapter.js";
export type { GrafanaProviderAdapter, GrafanaProviderAdapterDeps } from "./adapter.js";

// ---- Provider-dispatch registration ----
export {
  GRAFANA_PROVIDER_NAME,
  buildGrafanaGenericProviderClient,
  registerGrafanaProvider,
} from "./provider-registration.js";
export type { RegisterGrafanaProviderDeps } from "./provider-registration.js";

// ---- Mutation glue (work item 4) ----
export { buildGrafanaMutationPlan } from "./mutation/mutation-plan-builder.js";
export type { BuildGrafanaMutationPlanInput } from "./mutation/mutation-plan-builder.js";
export { requiredHighImpactFlagsFor } from "./mutation/high-impact-tagging.js";
export { resolveOptimisticConcurrencyConflict } from "./mutation/precondition.js";
export type { PreconditionConflictInput, PreconditionResolution } from "./mutation/precondition.js";
export { GrafanaRollbackSnapshotStore } from "./mutation/snapshot-store.js";
export { restoreFromSnapshot } from "./mutation/rollback.js";
export type { RollbackDeps, RollbackHttpResponse, RollbackOutcome } from "./mutation/rollback.js";
export { GrafanaPlanPayloadStore } from "./mutation/plan-payload-store.js";
export type { GrafanaPlanPayload } from "./mutation/plan-payload-store.js";
export { buildCanonicalTarget, parseCanonicalTarget } from "./mutation/canonical-target.js";
export type { ParsedCanonicalTarget } from "./mutation/canonical-target.js";
export { createGrafanaMutationApplyClient } from "./mutation/mutation-apply-client.js";
export type {
  GrafanaMutationApplyClientDeps,
  GrafanaRawHttpResponse,
} from "./mutation/mutation-apply-client.js";
export { applyGrafanaMutationWithRebase } from "./mutation/apply-with-rebase.js";
export type { ApplyWithRebaseDeps } from "./mutation/apply-with-rebase.js";
export { assertWritableCapability } from "./mutation/write-eligibility-guard.js";
export { buildCleanupReportForFailedCreate } from "./mutation/cleanup-report.js";
export type { GrafanaCleanupReport } from "./mutation/cleanup-report.js";

// ---- Reconciliation (deterministic UIDs + annotation tags) ----
export {
  createGrafanaMarkerReconciler,
  deriveAnnotationMarkerTag,
  deriveDeterministicUid,
} from "./reconciliation/marker-reconciler.js";
export type { MarkerLookupDeps } from "./reconciliation/marker-reconciler.js";

// ---- Query layer (work item 5) ----
export {
  GrafanaQueryValidationError,
  downsampleToResultBudget,
  processGrafanaQueryResult,
  scopeAndRedactRow,
  truncateRowToItemBudget,
  validateQueryTimeRange,
} from "./query/query-layer.js";
export type {
  GrafanaQueryRow,
  GrafanaQueryTimeRange,
  ProcessGrafanaQueryResultInput,
} from "./query/query-layer.js";

// ---- Annotation rendering (calls 17's renderWithRegeneration) ----
export { renderGrafanaAnnotationArtifact } from "./annotations/annotation-renderer.js";
export type { RenderGrafanaAnnotationArtifactInput } from "./annotations/annotation-renderer.js";

// ---- Optional Grafana MCP wrap (flag-gated CapabilityManifest entry) ----
export {
  GrafanaMcpWrapConfigError,
  buildGrafanaMcpWrapCapabilityEntry,
} from "./mcp-wrap/upstream-mcp-policy.js";
export type { GrafanaMcpWrapOptions } from "./mcp-wrap/upstream-mcp-policy.js";

// ---- Fixtures (work item 6): cassettes, Docker recipes, fault-injection matrix, latency counters ----
export {
  CREATE_INPUT_BY_KIND,
  DEFAULT_ANNOTATION_IDEMPOTENCY_KEY,
  RESOURCE_FLOW_ORDER,
  buildAnnotationVerifyResponse,
  buildKindCreateCassette,
} from "./fixtures/cassettes.js";
export type { BuildKindCreateCassetteOptions } from "./fixtures/cassettes.js";

// ---- Shared secret redaction (adversarial-review MEDIUM/LOW fixes) ----
export {
  REDACTED_PLACEHOLDER,
  redactCredentialShapedText,
  redactSecretBearingObject,
} from "./security/redaction.js";
export {
  ENTERPRISE_DOCKER_RECIPE,
  GRAFANA_DOCKER_RECIPES,
  OSS_DOCKER_RECIPE,
} from "./fixtures/docker-recipes.js";
export type { GrafanaDockerRecipe } from "./fixtures/docker-recipes.js";
export { FAULT_INJECTION_MATRIX } from "./fixtures/fault-injection-matrix.js";
export type { FaultInjectionScenario } from "./fixtures/fault-injection-matrix.js";
export {
  createGrafanaLatencyCounters,
  measureGrafanaOperation,
} from "./fixtures/latency-counters.js";
export type { GrafanaLatencyCounters, GrafanaLatencyStat } from "./fixtures/latency-counters.js";
