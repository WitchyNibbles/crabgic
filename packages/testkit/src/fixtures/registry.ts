import {
  AuthorizationEnvelopeSchema,
  CapabilityManifestSchema,
  CapabilitySnapshotSchema,
  ChangeSetSchema,
  CommunicationPolicySchema,
  EvidenceRecordSchema,
  ExternalConnectionSchema,
  IntentContractSchema,
  JournalEntryTypeSchema,
  LearningProposalSchema,
  PerformanceContractSchema,
  ProjectProfileSchema,
  RemoteMutationPlanSchema,
  RemoteOperationRecordSchema,
  RemoteResourceSchema,
  RenderedArtifactSchema,
  RequirementSchema,
  RunSnapshotSchema,
  StackEvidenceSchema,
  TaskPacketSchema,
  WorkUnitAttemptStatusSchema,
  WorkUnitSchema,
  WorkerResultSchema,
} from "@eo/contracts";
import type { z } from "zod";
import { buildAuthorizationEnvelope } from "./authorization-envelope.js";
import { buildCapabilityManifest } from "./capability-manifest.js";
import { buildCapabilitySnapshot } from "./capability-snapshot.js";
import { buildChangeSet } from "./change-set.js";
import { buildCommunicationPolicy } from "./communication-policy.js";
import { buildJournalEntryType, buildWorkUnitAttemptStatus } from "./enum-instances.js";
import { buildEvidenceRecord } from "./evidence-record.js";
import { buildExternalConnection } from "./external-connection.js";
import { buildIntentContract } from "./intent-contract.js";
import { buildLearningProposal } from "./learning-proposal.js";
import { buildPerformanceContract } from "./performance-contract.js";
import { buildProjectProfile } from "./project-profile.js";
import { buildRemoteMutationPlan } from "./remote-mutation-plan.js";
import { buildRemoteOperationRecord } from "./remote-operation-record.js";
import { buildRemoteResource } from "./remote-resource.js";
import { buildRenderedArtifact } from "./rendered-artifact.js";
import { buildRequirement } from "./requirement.js";
import { buildRunSnapshot } from "./run-snapshot.js";
import { buildStackEvidence } from "./stack-evidence.js";
import { buildTaskPacket } from "./task-packet.js";
import { buildWorkUnit } from "./work-unit.js";
import { buildWorkerResult } from "./worker-result.js";

/**
 * One registry entry per contract fixture builder. `build` is intentionally
 * zero-argument here (each concrete builder's own richer
 * `(overrides?: Partial<T>) => T` signature is only useful to a caller
 * that already knows `T`; the registry itself is deliberately type-erased
 * to `unknown` so it can hold all 21 builders in one homogeneous array) —
 * every registry consumer (the meta-test, the ajv integration harness)
 * only ever needs each builder's *default* output.
 */
export interface ContractFixtureEntry {
  readonly name: string;
  /** Matches `packages/contracts/schemas/<kebabName>.json` — the ajv harness's lookup key. */
  readonly kebabName: string;
  readonly schema: z.ZodTypeAny;
  readonly build: () => unknown;
}

export interface EnumFixtureEntry {
  readonly name: string;
  readonly schema: z.ZodTypeAny;
  readonly build: () => unknown;
}

/**
 * The 21 contracts (roadmap/02-contracts-and-schemas.md §In scope,
 * "Contracts (zod + JSON Schema export, 21)"), alphabetized by
 * `kebabName` — the same fixed, sorted order `build-schemas.ts` uses for
 * its own deterministic emission (see that script's doc comment).
 */
export const CONTRACT_FIXTURES: readonly ContractFixtureEntry[] = [
  {
    name: "AuthorizationEnvelope",
    kebabName: "authorization-envelope",
    schema: AuthorizationEnvelopeSchema,
    build: () => buildAuthorizationEnvelope(),
  },
  {
    name: "CapabilityManifest",
    kebabName: "capability-manifest",
    schema: CapabilityManifestSchema,
    build: () => buildCapabilityManifest(),
  },
  {
    name: "CapabilitySnapshot",
    kebabName: "capability-snapshot",
    schema: CapabilitySnapshotSchema,
    build: () => buildCapabilitySnapshot(),
  },
  {
    name: "ChangeSet",
    kebabName: "change-set",
    schema: ChangeSetSchema,
    build: () => buildChangeSet(),
  },
  {
    name: "CommunicationPolicy",
    kebabName: "communication-policy",
    schema: CommunicationPolicySchema,
    build: () => buildCommunicationPolicy(),
  },
  {
    name: "EvidenceRecord",
    kebabName: "evidence-record",
    schema: EvidenceRecordSchema,
    build: () => buildEvidenceRecord(),
  },
  {
    name: "ExternalConnection",
    kebabName: "external-connection",
    schema: ExternalConnectionSchema,
    build: () => buildExternalConnection(),
  },
  {
    name: "IntentContract",
    kebabName: "intent-contract",
    schema: IntentContractSchema,
    build: () => buildIntentContract(),
  },
  {
    name: "LearningProposal",
    kebabName: "learning-proposal",
    schema: LearningProposalSchema,
    build: () => buildLearningProposal(),
  },
  {
    name: "PerformanceContract",
    kebabName: "performance-contract",
    schema: PerformanceContractSchema,
    build: () => buildPerformanceContract(),
  },
  {
    name: "ProjectProfile",
    kebabName: "project-profile",
    schema: ProjectProfileSchema,
    build: () => buildProjectProfile(),
  },
  {
    name: "RemoteMutationPlan",
    kebabName: "remote-mutation-plan",
    schema: RemoteMutationPlanSchema,
    build: () => buildRemoteMutationPlan(),
  },
  {
    name: "RemoteOperationRecord",
    kebabName: "remote-operation-record",
    schema: RemoteOperationRecordSchema,
    build: () => buildRemoteOperationRecord(),
  },
  {
    name: "RemoteResource",
    kebabName: "remote-resource",
    schema: RemoteResourceSchema,
    build: () => buildRemoteResource(),
  },
  {
    name: "RenderedArtifact",
    kebabName: "rendered-artifact",
    schema: RenderedArtifactSchema,
    build: () => buildRenderedArtifact(),
  },
  {
    name: "Requirement",
    kebabName: "requirement",
    schema: RequirementSchema,
    build: () => buildRequirement(),
  },
  {
    name: "RunSnapshot",
    kebabName: "run-snapshot",
    schema: RunSnapshotSchema,
    build: () => buildRunSnapshot(),
  },
  {
    name: "StackEvidence",
    kebabName: "stack-evidence",
    schema: StackEvidenceSchema,
    build: () => buildStackEvidence(),
  },
  {
    name: "TaskPacket",
    kebabName: "task-packet",
    schema: TaskPacketSchema,
    build: () => buildTaskPacket(),
  },
  {
    name: "WorkUnit",
    kebabName: "work-unit",
    schema: WorkUnitSchema,
    build: () => buildWorkUnit(),
  },
  {
    name: "WorkerResult",
    kebabName: "worker-result",
    schema: WorkerResultSchema,
    build: () => buildWorkerResult(),
  },
];

/** The 2 new closed unions roadmap/02 work item 10 names alongside the 21 contracts. */
export const ENUM_FIXTURES: readonly EnumFixtureEntry[] = [
  {
    name: "WorkUnitAttemptStatus",
    schema: WorkUnitAttemptStatusSchema,
    build: () => buildWorkUnitAttemptStatus(),
  },
  {
    name: "JournalEntryType",
    schema: JournalEntryTypeSchema,
    build: () => buildJournalEntryType(),
  },
];

/** `CONTRACT_FIXTURES` ++ `ENUM_FIXTURES` — the meta-test's full 23-entry sweep. */
export const ALL_FIXTURES: readonly (ContractFixtureEntry | EnumFixtureEntry)[] = [
  ...CONTRACT_FIXTURES,
  ...ENUM_FIXTURES,
];
