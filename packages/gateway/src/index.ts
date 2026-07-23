/**
 * `@eo/gateway` public barrel — roadmap/16-gateway-core.md. Every
 * cross-cutting surface this phase produces (§Interfaces produced) is
 * exported from exactly this module; downstream phases (18, 20; 11/12 for
 * MCP tool-registry registration) import from `@eo/gateway` directly.
 */

// ---- Secrets (work item 1) ----
export {
  resolveSecretReference,
  SecretResolutionError,
} from "./secrets/secret-reference-resolver.js";

// ---- ExternalConnection store (work item 1) ----
export {
  InMemoryExternalConnectionStore,
  ExternalConnectionNotFoundError,
  resolveConnectionSecret,
} from "./connection-store/external-connection-store.js";
export type { ExternalConnectionRepository } from "./connection-store/external-connection-store.js";

export {
  buildHttpClientForConnection,
  buildAllowlistForConnection,
  resolveCustomCaPem,
} from "./connection-store/connection-http-client.js";

// ---- Transport security stack (work item 2) ----
export {
  checkHopBeforeCredentialAttach,
  checkOriginAllowlist,
  checkResolvedAddress,
  isPrivateOrReservedIp,
} from "./transport/ssrf-guard.js";
export type { SsrfAllowlist, SsrfGuardVerdict } from "./transport/ssrf-guard.js";

export { decideRetryAction } from "./transport/retry-ladder.js";
export type { HttpVerb, RetryAction, RetryDecisionInput } from "./transport/retry-ladder.js";

export { computeBackoffDelayMs, parseRetryAfterHeader } from "./transport/backoff.js";
export type { BackoffOptions } from "./transport/backoff.js";

export { WriteSerializer } from "./transport/write-serializer.js";
export type { WriteSerializerKey } from "./transport/write-serializer.js";

export { paginate, collectAllPages } from "./transport/pagination.js";
export type { Page, FetchPage } from "./transport/pagination.js";

export { NPlusOneDetector } from "./transport/n-plus-one-detector.js";
export type { NPlusOneDetectorOptions, NPlusOneReport } from "./transport/n-plus-one-detector.js";

export {
  enforceBudgets,
  enforceItemBudget,
  enforceResultBudget,
  BudgetExceededError,
  ITEM_BUDGET_BYTES,
  RESULT_BUDGET_BYTES,
} from "./transport/budgets.js";

export { resolveHostAddressesViaDns } from "./transport/dns-resolve.js";
export type { ResolveHostAddresses } from "./transport/dns-resolve.js";

export { sendHttpRequest } from "./transport/http-transport.js";
export type { HttpTransportRequest, HttpTransportResponse } from "./transport/http-transport.js";

export { GatewayHttpClient, SsrfRefusedError, MAX_REDIRECT_HOPS } from "./transport/http-client.js";
export type { GatewayHttpRequest, GatewayHttpClientOptions } from "./transport/http-client.js";

// ---- CapabilitySnapshot cache (work item 3) ----
export {
  CapabilitySnapshotCache,
  isInvalidatingError,
  DEFAULT_CAPABILITY_CACHE_TTL_SECONDS,
} from "./capability-snapshot/capability-snapshot-cache.js";
export type {
  DiscoverCapabilitySnapshot,
  CapabilitySnapshotCacheOptions,
} from "./capability-snapshot/capability-snapshot-cache.js";

// ---- Mutation pipeline (work item 4) ----
export {
  executeMutationPlan,
  IdempotencyKeyLock,
  MutationVerificationFailedError,
} from "./mutation-pipeline/mutation-pipeline.js";
export type {
  MutationApplyResult,
  MutationHttpRequestSpec,
  MutationPipelineHandlers,
  MutationPipelineOutcome,
  MutationOutcomeStatus,
  MutationPipelineDeps,
} from "./mutation-pipeline/mutation-pipeline.js";

export {
  reconcileAmbiguousPost,
  assertReconciled,
  AmbiguousWriteBlockedError,
} from "./mutation-pipeline/reconciliation.js";
export type { MarkerReconciler, AmbiguousPostOutcome } from "./mutation-pipeline/reconciliation.js";

export {
  mapHttpStatusToConnectorError,
  mapUnknownErrorToConnectorError,
} from "./mutation-pipeline/error-mapping.js";
export type { HttpStatusMappingInput } from "./mutation-pipeline/error-mapping.js";

// ---- Provider-dispatch point (work item 5) ----
export {
  ProviderRegistry,
  UnknownProviderError,
  DuplicateProviderError,
} from "./provider-dispatch/provider-registry.js";

// ---- Connection-doctor reachability probe ----
export { probeConnectionReachability } from "./connection-doctor/reachability-probe.js";
export type {
  ReachabilityProbeResult,
  ReachabilityProbeOptions,
} from "./connection-doctor/reachability-probe.js";

// ---- MCP tool registry + gateway MCP server (work item 5) ----
export { GatewayToolRegistry, DuplicateToolNameError } from "./mcp/tool-registry.js";
export type {
  GatewayToolDefinition,
  AnyGatewayToolDefinition,
  GatewayToolResult,
  GatewayToolTextContent,
  GatewayToolArgsShape,
  InferShape,
} from "./mcp/tool-registry.js";

export { buildGatewayMcpServer, connectGatewayMcpServer } from "./mcp/server.js";

export { buildNativeToolRegistry } from "./mcp/native-registry.js";
export type { NativeRegistryDeps } from "./mcp/native-registry.js";

export { forwardToSupervisor, UdsForwardError } from "./mcp/uds-forward-client.js";
export type { UdsForwardResponse, UdsForwardClientOptions } from "./mcp/uds-forward-client.js";

export type {
  GenericProviderClient,
  ProviderDispatchDeps,
} from "./mcp/native-tools/provider-dispatch-tool.js";
export { buildTrackerTools } from "./mcp/native-tools/tracker-tools.js";
export { buildObservabilityTools } from "./mcp/native-tools/observability-tools.js";
export { buildEvidenceTools } from "./mcp/native-tools/evidence-tools.js";
export { buildResultTools } from "./mcp/native-tools/result-tools.js";
export { buildRunForwardTools } from "./mcp/native-tools/run-forward-tools.js";

export { buildMutationApplyTool } from "./mcp/native-tools/mutation-apply-tool.js";
export type { MutationApplyToolDeps } from "./mcp/native-tools/mutation-apply-tool.js";
export type { MutationApplyClient } from "./mcp/native-tools/mutation-apply-client.js";

// ---- Fake-provider testkit (work item 6) ----
export { createFakeProviderTransport } from "./testkit/fake-provider-transport.js";
export type {
  FakeProviderScript,
  FakeProviderScriptEntry,
  FakeProviderCallRecord,
} from "./testkit/fake-provider-transport.js";

export {
  okResponse,
  rateLimitedResponse,
  authFailureResponse,
  conflictResponse,
  preconditionFailedResponse,
  malformedPageResponse,
  midPostTimeoutFault,
  FULL_FAULT_MATRIX,
} from "./testkit/fault-injection.js";

export { createFakeTrackerProvider } from "./testkit/fake-tracker-provider.js";
export type { FakeTrackerProviderHandle } from "./testkit/fake-tracker-provider.js";

export { createFakeObservabilityProvider } from "./testkit/fake-observability-provider.js";
export type { FakeObservabilityProviderHandle } from "./testkit/fake-observability-provider.js";

export { createFakePaginatedSource } from "./testkit/fake-paginated-source.js";

// ---- Optional upstream-MCP-client wrap policy ----
export {
  UpstreamMcpClientPolicyStore,
  buildSimulatedWorkerMcpServers,
} from "./mcp/upstream-mcp-client-policy.js";
