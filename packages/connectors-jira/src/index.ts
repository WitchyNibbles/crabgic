/**
 * `@eo/connectors-jira` public barrel — roadmap/18-jira-cloud-adapter.md
 * §Interfaces produced. Downstream phases (19 Jira Data Center; 21
 * connector evidence; 23 release hardening) import from
 * `@eo/connectors-jira` directly. This phase registers no MCP tool of
 * its own (roadmap/18 §Interfaces consumed) — `./provider/register.ts`'s
 * `registerJiraCloudProvider` is the one call site that plugs this
 * package into `@eo/gateway`'s already-registered `tracker.*` tools.
 */

// ---- Auth: OAuth client-credentials token manager + connection doctor (work item 1) ----
export {
  JiraTokenManager,
  type FetchJiraOAuthToken,
  type JiraAccessToken,
  type JiraOAuthTokenResponse,
  type JiraTokenManagerOptions,
} from "./auth/token-manager.js";
export {
  buildJiraOAuthTokenFetcher,
  type JiraOAuthClientCredentials,
  type JiraOAuthHttpOptions,
} from "./auth/jira-oauth-http.js";
export {
  runJiraConnectionDoctor,
  type JiraConnectionDoctorInput,
  type JiraConnectionDoctorResult,
} from "./auth/connection-doctor.js";

// ---- Errors + security (canonical-error mapping, pre-flight capability guard) ----
export {
  JIRA_PROVIDER_NAME,
  mapJiraStatusToConnectorErrorKind,
} from "./errors/jira-error-mapping.js";
export { assertAllowedJiraOperation } from "./security/preflight-capability-guard.js";

// ---- Capability discovery + field metadata (work item 3) ----
export {
  discoverJiraCapabilitySnapshot,
  discoverJiraFieldMetadata,
} from "./capability/discovery.js";
export {
  assertCustomFieldWritesAreDiscovered,
  buildFieldMetadataIndex,
  isKnownJiraFieldSchemaType,
  KNOWN_JIRA_FIELD_SCHEMA_TYPES,
  type FieldMetadataIndex,
  type JiraFieldSchemaType,
} from "./capability/field-metadata.js";

// ---- JiraWorkflowStage never-guess transition mapper ----
export {
  isJiraWorkflowStage,
  JIRA_WORKFLOW_STAGES,
  mapJiraStatusToWorkflowStage,
  type JiraStatusCategoryKey,
  type JiraWorkflowStage,
} from "./workflow/workflow-stage.js";

// ---- High-impact capability flags (the 7-member Jira subset) ----
export {
  JIRA_HIGH_IMPACT_FLAGS,
  requiredCapabilityFlagsForIssueUpdate,
  requiredCapabilityFlagsForTransition,
  unconditionalCapabilityFlagFor,
} from "./high-impact-capabilities.js";

// ---- JiraResourceClient: types, actions, and the concrete implementation (work item 2) ----
export { JIRA_ACTIONS, isJiraAction, type JiraAction } from "./resource-client/actions.js";
export type {
  JiraBoard,
  JiraComment,
  JiraFieldMetadata,
  JiraIssue,
  JiraIssueLink,
  JiraIssueSearchResult,
  JiraIssueStatus,
  JiraProject,
  JiraResourceClient,
  JiraSprint,
  JiraSprintState,
  JiraTransition,
  JiraWorklog,
} from "./resource-client/types.js";
export type { JiraHttpContext } from "./resource-client/http-read-helper.js";
export {
  createJiraResourceClient,
  type CreateJiraResourceClientDeps,
} from "./resource-client/jira-resource-client.js";
export { assertDoneTransitionHasEvidence } from "./resource-client/issue-plans.js";
export {
  buildJiraMutationPlan,
  computeDesiredStateHash,
  type BuildJiraMutationPlanInput,
  type JiraPlanBuildContext,
} from "./resource-client/plan-builder.js";
export { JiraPlanPayloadRegistry } from "./resource-client/plan-payload-registry.js";

// ---- GenericProviderClient / MutationApplyClient adapters (dispatch surface backing) ----
export {
  createJiraProviderClient,
  type JiraDispatchResource,
} from "./resource-client/jira-provider-client.js";
export {
  createJiraMutationApplyClient,
  type JiraMutationApplyDeps,
} from "./resource-client/jira-mutation-apply-client.js";

// ---- Provider registration (the connectors-jira <-> @eo/gateway seam) ----
export {
  JIRA_PROVIDER_NAME as JIRA_CLOUD_PROVIDER_KEY,
  registerJiraCloudProvider,
  type RegisterJiraCloudProviderDeps,
} from "./provider/register.js";
export {
  JiraConnectionNotRegisteredError,
  JiraConnectionRegistry,
  type JiraConnectionEntry,
  type RegisterJiraConnectionOptions,
} from "./provider/jira-connection-registry.js";

// ---- Reconciliation: Jira entity-property MarkerReconciler (work item 6 / exit criteria) ----
export {
  createJiraEntityPropertyMarkerReconciler,
  type JiraMarkerKind,
} from "./reconciliation/entity-property-marker.js";

// ---- Attachment streaming-validation pipeline + staging registry (work item 5) ----
export {
  MAX_ATTACHMENT_BYTES,
  validateAttachmentBeforeStaging,
  type AttachmentCandidate,
  type AttachmentValidationResult,
} from "./attachments/attachment-pipeline.js";
export {
  AttachmentStagingNotFoundError,
  AttachmentStagingRegistry,
  type StagedAttachment,
} from "./attachments/attachment-staging.js";

// ---- Intake: reference resolution, revision comparator, milestone sync (work item 4) ----
export {
  buildDraftIssueDescriptionAdf,
  extractJiraIssueKeyFromReference,
  validateDraftIssueSummary,
} from "./intake/intake-engine.js";
export {
  compareRemoteResourceRevisions,
  stampJiraRemoteResource,
  type MaterialChangeSignal,
  type StampJiraRemoteResourceInput,
} from "./intake/revision-comparator.js";
export {
  MILESTONE_EVENT_KINDS,
  planMilestoneSync,
  type MilestoneEventKind,
  type MilestoneSyncDeps,
  type MilestoneSyncInput,
  type MilestoneSyncJournalEntryPayload,
  type MilestoneSyncOutcome,
} from "./intake/milestone-sync.js";

// ---- Testkit: fake-Jira transport wiring + fault matrix + cassette (work item 6) ----
export {
  HAND_AUTHORED_READ_SCENARIO,
  loadReadScenarioCassette,
  runScriptedReadScenario,
  type ScenarioResults,
} from "./testkit/scripted-read-scenario.js";
export { JIRA_FAULT_MATRIX } from "./testkit/fault-matrix.js";

// ============================================================
// Phase 19 (Jira Data Center adapter) — everything below is new.
// ============================================================

// ---- Deployment-type / auth-mode config (work item 1) ----
export {
  JIRA_AUTH_MODES,
  JIRA_DEPLOYMENT_TYPES,
  JiraConnectionConfigSchema,
  assertBasicAuthPermitted,
  type JiraAuthMode,
  type JiraConnectionConfig,
  type JiraDeploymentType,
} from "./provider/jira-connection-config.js";
export {
  JIRA_DATACENTER_PROVIDER_NAME,
  mapJiraDatacenterStatusToConnectorErrorKind,
} from "./errors/jira-error-mapping.js";

// ---- PAT/basic auth + doctor checks (work item 1) ----
export {
  buildJiraBasicAuthHeaderProvider,
  buildJiraPatAuthHeaderProvider,
  resolveJiraDatacenterAuthHeaderProvider,
  type JiraAuthHeaderProvider,
} from "./auth/jira-datacenter-auth.js";
export {
  runJiraDatacenterConnectionDoctor,
  type JiraDatacenterConnectionDoctorInput,
  type JiraDatacenterConnectionDoctorResult,
} from "./auth/connection-doctor-datacenter.js";

// ---- DcEditionFeatureMatrix (work item 3) ----
export {
  isActionSupportedForDcEdition,
  normalizeDcEdition,
  resolveDcEditionFeatures,
  type DcEditionEntry,
} from "./capability/dc-edition-feature-matrix.js";
export { discoverJiraDatacenterCapabilitySnapshot } from "./capability/discovery-datacenter.js";

// ---- DC resource-client implementation (REST v2 + Agile, work item 2) ----
export type { JiraDatacenterHttpContext } from "./resource-client/datacenter/jira-datacenter-http-context.js";
export { jiraDatacenterGetJson } from "./resource-client/datacenter/jira-datacenter-http-context.js";
export {
  createJiraDatacenterResourceClient,
  type CreateJiraDatacenterResourceClientDeps,
} from "./resource-client/datacenter/jira-datacenter-resource-client.js";
export {
  createJiraDatacenterMutationApplyClient,
  type JiraDatacenterMutationApplyDeps,
} from "./resource-client/datacenter/jira-mutation-apply-client-dc.js";

// ---- wikiMarkupRenderProfile (work item 4) ----
export { adfDocumentToWikiMarkup } from "./resource-client/datacenter/wiki-markup-render-profile.js";

// ---- Reconciliation (DC entity-property marker) ----
export { createJiraDatacenterEntityPropertyMarkerReconciler } from "./reconciliation/entity-property-marker-dc.js";

// ---- Provider registration (the DC <-> @eo/gateway seam) ----
export {
  JIRA_DATACENTER_PROVIDER_KEY,
  registerJiraDatacenterProvider,
  type RegisterJiraDatacenterProviderDeps,
} from "./provider/register-datacenter.js";
export {
  JiraDatacenterConnectionNotRegisteredError,
  JiraDatacenterConnectionRegistry,
  type JiraDatacenterConnectionEntry,
  type RegisterJiraDatacenterConnectionOptions,
} from "./provider/jira-datacenter-connection-registry.js";

// ---- Testkit: DC fault matrix + cassette fixtures (work items 6-7) ----
export { JIRA_DATACENTER_FAULT_MATRIX } from "./testkit/fault-matrix-dc.js";
export {
  loadDatacenterReadScenarioCassette,
  runDatacenterScriptedReadScenario,
} from "./testkit/scripted-read-scenario-dc.js";
