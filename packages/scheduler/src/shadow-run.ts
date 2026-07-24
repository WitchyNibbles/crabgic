/**
 * Shadow-run mechanism — roadmap/13-scheduler-packets-context.md §In
 * scope, "Shadow-run mode": "given an existing WorkUnit and a candidate
 * lesson preamble, executes an isolated mirrored attempt — its own
 * worktree and session, cache-bypassed, no mutation of the primary
 * attempt's journal state beyond a marker entry — and returns the
 * resulting WorkerResult/artifact handle. This phase owns isolated
 * execution only; comparison and grading logic belong to 22."
 *
 * ISOLATION, BY CONSTRUCTION (roadmap/13 §Test plan, Security: "a shadow
 * attempt's artifacts and cache writes are never reachable from the
 * primary attempt's read path... including under adversarial same-
 * content-hash collisions"):
 *  - Worktree/session: the caller supplies a DEDICATED `SessionRef`/
 *    `TaskPacket` for the shadow attempt (07's worktree lifecycle is out
 *    of this phase's scope to create — this function only ever dispatches
 *    against whatever isolated session/profile it is given, never the
 *    primary's own).
 *  - Cache: this module contains NO reference to `./cache.ts` anywhere —
 *    the strongest possible form of "bypass," since there is no code path
 *    by which a shadow attempt could ever read OR write the cache, let
 *    alone under a same-content-hash collision.
 *  - Artifacts: `runShadowAttempt` always receives/returns a FRESH
 *    `ArtifactStore` instance (see `./artifact-store.ts`'s own doc
 *    comment on why two instances can never observe each other).
 *  - Journal: exactly ONE entry is ever written by this function — a
 *    `adjudication_decision` marker (`SHADOW_RUN_MARKER_DECISION`) —
 *    never a `work_unit_transition`/`session_assignment` for the primary
 *    attempt.
 */

import type { AdjudicationCallback, CompiledWorkerProfile, EngineAdapter } from "@eo/engine-core";
import type { TaskPacket, WorkerResult } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
import { ArtifactStore } from "./artifact-store.js";
import {
  validateWorkerResult,
  type SchedulerWorkerResultValidation,
} from "./worker-result-validation.js";

/** The `decision` value every shadow-run marker entry carries — distinguishes it from a real adjudication verdict or a rate-limit park timer. */
export const SHADOW_RUN_MARKER_DECISION = "shadow_run_marker";

export interface RunShadowAttemptOptions {
  readonly adapter: EngineAdapter;
  /** The mirrored attempt's OWN packet — typically built with a lesson-preamble via `../task-packet-builder.ts`'s `lessonPreamble` slot. */
  readonly packet: TaskPacket;
  /** The mirrored attempt's OWN compiled profile (never the primary's). */
  readonly profile: CompiledWorkerProfile;
  readonly adjudicate: AdjudicationCallback;
  readonly journal: JournalStore;
  /** The primary `WorkUnit` this shadow attempt mirrors — carried ONLY in the one marker entry's `subjectId`, never used to touch the primary's own transitions. */
  readonly primaryWorkUnitId: string;
}

export interface ShadowRunResult {
  readonly sessionId: string;
  readonly validation: SchedulerWorkerResultValidation;
  /** Convenience accessor — `undefined` on a schema violation. */
  readonly workerResult: WorkerResult | undefined;
  /** A brand-new, fully isolated store — see file-level doc comment. */
  readonly artifacts: ArtifactStore;
}

/**
 * Runs one isolated mirrored attempt to completion (or to a schema
 * violation), never touching the primary attempt's cache/artifacts, and
 * writing exactly one journal entry (the marker). Never throws for a
 * schema-violating result — that is reported via `validation`, matching
 * this phase's own "never a silent pass" pattern for worker results.
 */
export async function runShadowAttempt(options: RunShadowAttemptOptions): Promise<ShadowRunResult> {
  const handle = options.adapter.spawn(options.packet, options.profile, options.adjudicate);
  const artifacts = new ArtifactStore();
  const attemptId = `shadow:${handle.sessionRef.sessionId}`;

  let validation: SchedulerWorkerResultValidation = {
    kind: "schemaViolation",
    reason: "absent",
    diagnostics: ["shadow attempt's event stream ended with no terminal result event (crash)"],
  };

  for await (const event of handle.events) {
    artifacts.put({
      workUnitId: options.packet.workUnitId,
      attemptId,
      kind: "log",
      content: JSON.stringify(event),
    });
    if (event.type === "result") {
      validation = validateWorkerResult(event);
    }
  }

  // The ONLY journal write this function ever performs — a marker entry,
  // never a mutation of the primary attempt's own transition history.
  await options.journal.appendEntry({
    type: "adjudication_decision",
    workUnitId: options.primaryWorkUnitId,
    payload: {
      decision: SHADOW_RUN_MARKER_DECISION,
      rationale: `Shadow-run mirrored attempt (session ${handle.sessionRef.sessionId}) completed with outcome "${validation.kind}".`,
      subjectId: options.primaryWorkUnitId,
    },
  });

  return {
    sessionId: handle.sessionRef.sessionId,
    validation,
    workerResult: validation.kind === "valid" ? validation.result : undefined,
    artifacts,
  };
}
