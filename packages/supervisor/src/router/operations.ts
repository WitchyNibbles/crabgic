/**
 * Router operation vocabulary — roadmap/05-supervisor-daemon.md §Router
 * surface: "carries every supervisor-owned operation family the CLI and
 * the gateway need, not a narrow fixed triple — `run.status`/`run.cancel`;
 * the registry reads backing 09's `status`/`evidence`/`resume`; and
 * internal `worker.*` administration." `run.*` stays UDS-only — this
 * package registers NO MCP tool anywhere (16's gateway forwards
 * `run.status`/`run.cancel` over this same UDS transport later; it never
 * duplicates the handler).
 *
 * There is deliberately NO change-set-family (leading token "change_set",
 * dot-separated leaf) operation anywhere in this list (interface-ledger
 * Gap 1: "ChangeSet-state queries are answered exclusively" by 11's
 * `project.inspect`, itself reading `registry.changeSets.*` over this same
 * UDS surface, never exposing a dedicated wire operation of its own for
 * that deleted family) — enforced by `no-change-set-operation.test.ts`'s
 * repo-wide grep scan (deliberately not spelling the banned literal out
 * verbatim in this comment — see that test file's own doc comment for why).
 */

import { z } from "zod";
import {
  ChangeSetSchema,
  IdSchema,
  NonEmptyStringSchema,
  RunLifecycleStateSchema,
  WorkUnitSchema,
} from "@eo/contracts";

/** This phase's own minimal-sufficient run-registry read shape — see `../registries/runs-registry.ts`'s own doc comment for why it is not `RunSnapshot` itself. */
export const RunRecordSchema = z
  .object({
    runId: IdSchema,
    changeSetId: IdSchema,
    runState: RunLifecycleStateSchema,
    updatedAt: z.string(),
  })
  .strict();
export type RunRecord = z.infer<typeof RunRecordSchema>;

export const WorkerStatusSchema = z.enum([
  "starting",
  "running",
  "terminating",
  "terminated",
  "crashed",
]);
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

/** Carries the engine `session_id` (roadmap/05 §Registries: "workers (carrying the engine `session_id`)"). */
export const WorkerRecordSchema = z
  .object({
    workerId: IdSchema,
    workUnitId: IdSchema,
    sessionId: IdSchema,
    status: WorkerStatusSchema,
    startedAt: z.string(),
    terminatedAt: z.string().optional(),
  })
  .strict();
export type WorkerRecord = z.infer<typeof WorkerRecordSchema>;

export const ArtifactIndexEntrySchema = z
  .object({
    id: IdSchema,
    changeSetId: IdSchema,
    evidenceRecordId: IdSchema,
    digest: NonEmptyStringSchema,
  })
  .strict();
export type ArtifactIndexEntry = z.infer<typeof ArtifactIndexEntrySchema>;

const EmptyParamsSchema = z.object({}).strict();

// ---- run.status / run.cancel (Gap 1: exact names, UDS-only, never an MCP tool registered here) ----
export const RunStatusParamsSchema = z.object({ runId: IdSchema }).strict();
export const RunStatusResultSchema = z.object({ run: RunRecordSchema.optional() }).strict();

export const RunCancelParamsSchema = z
  .object({ runId: IdSchema, reason: NonEmptyStringSchema.optional() })
  .strict();
export const RunCancelResultSchema = z
  .object({ accepted: z.boolean(), runState: RunLifecycleStateSchema.optional() })
  .strict();

// ---- registry reads backing 09's status/evidence/resume ----
export const RegistryChangeSetGetParamsSchema = z.object({ changeSetId: IdSchema }).strict();
export const RegistryChangeSetGetResultSchema = z
  .object({ changeSet: ChangeSetSchema.optional() })
  .strict();

/**
 * Lists every run the daemon currently knows about — what `status` with no
 * run-id needs (roadmap/09 §Commands: "`status [run-id]`"). Added 2026-07-25:
 * without it the CLI could only ever ask about a run whose id the operator
 * already had, so the no-argument form of the command was unimplementable
 * and returned NOT_IMPLEMENTED.
 *
 * This is an INTERNAL UDS operation, not a gateway MCP tool: the interface
 * ledger's Gap 1 fixes the MCP tool surface (and forwards only
 * `run.status`/`run.cancel` over UDS) and never enumerates the `registry.*`
 * family, so adding a member here changes no ledger ruling. It mirrors the
 * existing `registry.changeSets.list`/`registry.workUnits.list` shape
 * exactly, and returns the same `RunRecord` that `run.status` already does.
 */
/**
 * Begins driving an approved DAG (roadmap/13's `driveRun`). Added
 * 2026-07-25 — before it, an approved run had no way to execute at all.
 *
 * `accepted: false` is a normal answer (already in flight, unknown run, no
 * dispatcher configured), never an error, mirroring `run.cancel`'s own
 * accepted/reason shape. Like `run.status`/`run.cancel` this is UDS-only
 * and is NOT registered as a gateway MCP tool: dispatching a run is an
 * operator action, never a model-satisfiable one.
 */
export const RunDispatchParamsSchema = z.object({ runId: IdSchema }).strict();
export const RunDispatchResultSchema = z
  .object({ accepted: z.boolean(), reason: NonEmptyStringSchema.optional() })
  .strict();

export const RegistryRunsListParamsSchema = EmptyParamsSchema;
export const RegistryRunsListResultSchema = z.object({ runs: z.array(RunRecordSchema) }).strict();

export const RegistryChangeSetListParamsSchema = EmptyParamsSchema;
export const RegistryChangeSetListResultSchema = z
  .object({ changeSets: z.array(ChangeSetSchema) })
  .strict();

export const RegistryWorkUnitListParamsSchema = z
  .object({ changeSetId: IdSchema.optional() })
  .strict();
export const RegistryWorkUnitListResultSchema = z
  .object({ workUnits: z.array(WorkUnitSchema) })
  .strict();

export const RegistryWorkUnitGetParamsSchema = z.object({ workUnitId: IdSchema }).strict();
export const RegistryWorkUnitGetResultSchema = z
  .object({ workUnit: WorkUnitSchema.optional() })
  .strict();

export const RegistryWorkersListParamsSchema = z
  .object({ workUnitId: IdSchema.optional() })
  .strict();
export const RegistryWorkersListResultSchema = z
  .object({ workers: z.array(WorkerRecordSchema) })
  .strict();

export const RegistryArtifactIndexListParamsSchema = z
  .object({ changeSetId: IdSchema.optional() })
  .strict();
export const RegistryArtifactIndexListResultSchema = z
  .object({ artifacts: z.array(ArtifactIndexEntrySchema) })
  .strict();

// ---- internal worker.* administration ----
export const WorkerTerminateParamsSchema = z
  .object({ workerId: IdSchema, graceMs: z.number().int().nonnegative().optional() })
  .strict();
export const WorkerTerminateResultSchema = z
  .object({ accepted: z.boolean(), status: WorkerStatusSchema.optional() })
  .strict();

export const WorkerReapOrphansParamsSchema = EmptyParamsSchema;
export const WorkerReapOrphansResultSchema = z
  .object({ reapedWorkerIds: z.array(IdSchema) })
  .strict();

/** Every operation name this package's router registers — the closed vocabulary the Gap 1 conformance test scans for a banned change-set-family violation against, and the source of truth `router.ts`'s own construction wires 1:1. */
export const SUPERVISOR_OPERATIONS = [
  "run.status",
  "run.cancel",
  "run.dispatch",
  "registry.runs.list",
  "registry.changeSets.get",
  "registry.changeSets.list",
  "registry.workUnits.list",
  "registry.workUnits.get",
  "registry.workers.list",
  "registry.artifactIndex.list",
  "worker.terminate",
  "worker.reapOrphans",
] as const;
export type SupervisorOperation = (typeof SUPERVISOR_OPERATIONS)[number];
