/**
 * The DAG run driver — roadmap/13-scheduler-packets-context.md §Goal: "the
 * DAG approved in 11 executes to completion without further human
 * intervention: a default-serial, evidence-gated dispatch loop turns each
 * ready WorkUnit into a bounded attempt via 06's EngineAdapter, fans out
 * only when independence is proven (≤4 concurrent, delegation depth 1,
 * rationale journaled)."
 *
 * This is work item 1's "Executor" sentence completed. Before it, every
 * ingredient existed and was independently tested — `computeReadyUnits`
 * (readiness), `selectDispatchSet` (fan-out), `dispatchAttempt` (one bounded
 * attempt), `parkWorkUnit` (limit parking) — but nothing composed them into
 * a loop, so `dispatchAttempt` had ZERO production callers and an approved
 * DAG could never actually execute. `driveRun` is the missing composition.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO — every engine-, git- and
 * envelope-touching concern is an injected seam, never constructed here:
 *
 *   - `createAdapter` — 06 owns the real `ClaudeEngineAdapter` (and its
 *     per-attempt worktree `cwd`). This package must not depend on
 *     `@crabgic/engine-claude`: that package already depends on `@crabgic/supervisor`,
 *     and the daemon composes both. The driver speaks only 03's
 *     `EngineAdapter` interface.
 *   - `buildPacket` — the caller owns the approved envelope, frozen base
 *     object id, and result schema that `./task-packet-builder.ts` needs;
 *     the driver never invents packet scope.
 *   - `compileProfile` — 03's envelope compiler output.
 *
 * `liveWorkers` is the same map `@crabgic/supervisor`'s composition root hands to
 * its router, structurally typed here so this package needs no dependency on
 * the supervisor: registering an in-flight attempt there is what makes 05's
 * `worker.terminate` operation able to reach a running worker at all.
 */
import { getLatestAttemptForRun, type JournalStore } from "@crabgic/journal";
import type {
  AdjudicationCallback,
  CompiledWorkerProfile,
  EngineAdapter,
} from "@crabgic/engine-core";
import type { TaskPacket, WorkUnit, WorkUnitAttemptStatus } from "@crabgic/contracts";
import type { CollisionVerdict } from "@crabgic/git-engine";
import { computeReadyUnits } from "./readiness.js";
import {
  DEFAULT_CONCURRENCY_CAP,
  journalFanoutRationaleIfFannedOut,
  selectDispatchSet,
} from "./fanout.js";
import { dispatchAttempt, type DispatchAttemptOutcome } from "./executor.js";
import { GlobalPauseActiveError } from "./errors.js";
import { getParkStatus, isGloballyPaused } from "./parking.js";
import { resolveModelForRole } from "./router.js";
// NOTE: this driver briefly also carried an in-memory `AttemptCacheSeam`
// (phase 13's `SchedulerCache`, wired 2026-07-30). The journal-seeding
// below supersedes it — a succeeded unit is seeded from the DURABLE journal
// and never re-selected, which is what the cache did, but restart-safe and
// without a second in-memory mechanism to keep in sync. The cache layer was
// removed rather than left as unreachable dead code (its own review's F2).

/** The per-attempt context every injected seam receives — enough to construct a worktree-scoped adapter, a packet, and a compiled profile without the driver knowing how any of them are built. */
export interface WorkerDispatchContext {
  readonly workUnit: WorkUnit;
  /** Role-routed model alias (`./router.ts`), resolved at dispatch time per roadmap/13 §Model routing. */
  readonly model: string;
  readonly runId: string;
  readonly changeSetId: string;
}

/**
 * A worker handle the control plane can terminate mid-flight. Structurally
 * identical to `@crabgic/supervisor`'s `TerminableWorker` — declared here rather
 * than imported so this package keeps no dependency on the supervisor (13
 * layers ON TOP of 05; the edge must not point back).
 */
export interface DriverTerminableWorker {
  terminate(graceMs: number): Promise<{ readonly outcome: string }>;
}

export interface RunDriverDependencies {
  readonly journal: JournalStore;
  /** The supervisor's live-worker map — an in-flight attempt is registered under its work-unit id for the duration of the attempt. */
  readonly liveWorkers: Map<string, DriverTerminableWorker>;
  readonly adjudicate: AdjudicationCallback;
  readonly createAdapter: (ctx: WorkerDispatchContext) => Promise<EngineAdapter>;
  readonly buildPacket: (ctx: WorkerDispatchContext) => Promise<TaskPacket>;
  readonly compileProfile: (ctx: WorkerDispatchContext) => Promise<CompiledWorkerProfile>;
  /** Role -> model alias. Defaults to `./router.ts`'s balanced-default map. */
  readonly resolveModel?: (role: string) => string;
  /** Epoch-SECONDS clock (matching `EngineLimitSignalEvent.resetsAt`, docs/engine-baseline.md §8) used for the global-pause window check. Defaults to the real wall clock. */
  readonly nowSeconds?: () => number;
  /**
   * Resumes a rate-limit-parked unit whose reset window has passed, via 13's
   * `resumeAttempt({kind:"parkResume"})` path — the ONLY way to continue a
   * parked unit, since re-dispatching it fresh would count its original
   * dispatch toward the repair budget and be refused. The caller (the
   * daemon dispatcher) reconstructs the `SessionRef` from the RETAINED
   * per-unit adapter that spawned the session, so the resumed session keeps
   * full authority rather than the read-only fallback a stranger adapter
   * gets. `sessionId` comes from the park record; the outcome folds back
   * exactly like a fresh dispatch.
   *
   * ABSENT means parked units are left parked (the run stops `parked`) — the
   * behaviour before this seam existed. Returning `undefined` means the same
   * for THIS unit: the caller could not resume it (no retained adapter — a
   * re-drive after a daemon restart) and declined rather than resume into a
   * read-only session, so the driver leaves it parked. Same-daemon only.
   */
  readonly resumeParkedUnit?: (
    ctx: WorkerDispatchContext,
    sessionId: string,
  ) => Promise<DispatchAttemptOutcome | undefined>;
}

export interface DriveRunOptions {
  readonly runId: string;
  readonly changeSetId: string;
  readonly workUnits: readonly WorkUnit[];
  /** 07's rename-aware path-collision verdicts — units that collide are never dispatched in the same round. */
  readonly overlapVerdicts?: readonly CollisionVerdict[];
  /** Max concurrent attempts per round. Defaults to `DEFAULT_CONCURRENCY_CAP` (roadmap/13: cap 4). */
  readonly concurrencyCap?: number;
  /** Hard upper bound on dispatch rounds — a loop backstop, never the normal termination condition. Defaults to `workUnits.length + 1`. */
  readonly maxRounds?: number;
}

/**
 * Why the loop stopped.
 * - `completed`: every unit reached a terminal status.
 * - `blocked`: units remain pending but none is ready (a dependency failed
 *   or was cancelled) — the run needs repair or human intervention.
 * - `parked`: an account-wide rate limit halted dispatch; resumable once
 *   the reset window passes (`./parking.ts`).
 * - `roundLimit`: the backstop tripped — a bug, not an expected outcome.
 */
export type DriveRunStopReason = "completed" | "blocked" | "parked" | "roundLimit";

export interface UnitAttemptOutcome {
  readonly workUnitId: string;
  readonly outcome: DispatchAttemptOutcome;
}

export interface DriveRunResult {
  readonly statusById: ReadonlyMap<string, WorkUnitAttemptStatus>;
  readonly outcomes: readonly UnitAttemptOutcome[];
  readonly stopped: DriveRunStopReason;
  /** Dispatch rounds actually executed — one round may carry up to `concurrencyCap` attempts. */
  readonly rounds: number;
}

/** Maps one attempt outcome onto the work unit's next `WorkUnitAttemptStatus`. A crash is a failure for readiness purposes: the unit is not retried by this loop (repair is 13's evidence-gated `resumeAttempt` path, driven deliberately, never automatically). */
function statusForOutcome(outcome: DispatchAttemptOutcome): WorkUnitAttemptStatus {
  switch (outcome.kind) {
    case "succeeded":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "parked":
      return "parked:rate_limit";
    case "failed":
    case "crashed":
      return "failed";
  }
}

/** Runs one bounded attempt, keeping the supervisor's live-worker map accurate for exactly the attempt's duration. */
async function runOneAttempt(
  ctx: WorkerDispatchContext,
  deps: RunDriverDependencies,
): Promise<DispatchAttemptOutcome> {
  const [adapter, packet, profile] = await Promise.all([
    deps.createAdapter(ctx),
    deps.buildPacket(ctx),
    deps.compileProfile(ctx),
  ]);
  return runDispatch(adapter, packet, profile, ctx, deps);
}

/** The dispatch half of an attempt (the seams resolved, now run it). */
async function runDispatch(
  adapter: EngineAdapter,
  packet: TaskPacket,
  profile: CompiledWorkerProfile,
  ctx: WorkerDispatchContext,
  deps: RunDriverDependencies,
): Promise<DispatchAttemptOutcome> {
  try {
    return await dispatchAttempt({
      adapter,
      journal: deps.journal,
      packet,
      profile,
      adjudicate: deps.adjudicate,
      // First dispatch of a unit needs no repair evidence; a repair
      // re-dispatch is `resumeAttempt`'s evidence-gated path, never this
      // loop's (`./attempt-policy.ts`).
      evidenceKind: "none",
      runId: ctx.runId,
      // Registered the moment the worker exists and retired in `finally`
      // below, so the control plane can terminate it for exactly the window
      // it is actually running — and never holds a handle to a dead one.
      onWorkerHandle: (handle) => {
        deps.liveWorkers.set(ctx.workUnit.id, {
          terminate: async (graceMs) => {
            // `EngineAdapter.cancel` takes an absolute deadline Timestamp,
            // not a duration — the grace window is relative to now.
            await adapter.cancel(handle, new Date(Date.now() + graceMs).toISOString());
            return { outcome: "terminated" };
          },
        });
      },
    });
  } finally {
    deps.liveWorkers.delete(ctx.workUnit.id);
  }
}

/**
 * Drives an approved DAG to completion. See the file-level doc comment for
 * the injected-seam boundary. Each round: compute the ready set, select a
 * non-colliding dispatch subset within the concurrency cap, journal a
 * fan-out rationale if it fanned out, run those attempts concurrently, fold
 * their outcomes back into the status map, and repeat.
 */
export async function driveRun(
  options: DriveRunOptions,
  deps: RunDriverDependencies,
): Promise<DriveRunResult> {
  const overlapVerdicts = options.overlapVerdicts ?? [];
  const concurrencyCap = options.concurrencyCap ?? DEFAULT_CONCURRENCY_CAP;
  // Each unit can consume up to TWO rounds now: one to dispatch it, and one to
  // RESUME it after a rate-limit park. (A resume that re-parks sets a FUTURE
  // reset, so it is not ready-to-resume again this drive and the drive stops
  // `parked` — the resume path cannot spin within a drive, so a unit is
  // resumed at most once per drive.) Before active park resume this was
  // `length + 1`; a run where more than one unit parked would then have
  // tripped this backstop into a false `roundLimit`.
  const maxRounds = options.maxRounds ?? options.workUnits.length * 2 + 1;
  const resolveModel = deps.resolveModel ?? resolveModelForRole;
  const nowSeconds = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  // Seed each unit's status from the JOURNAL, not the stored WorkUnit.
  // Nothing updates a stored `attemptStatus` after intake (see the file-level
  // note), so on a RE-DRIVE — `resume` after a crash or a limit park —
  // `unit.attemptStatus` is still `pending` for every unit, and the loop
  // would re-select units that already succeeded, failed or parked. A
  // succeeded unit then either re-executed (real engine spend) or, once its
  // dispatch was journaled, was REFUSED by the repair-evidence gate and the
  // whole drive crashed. Folding the journal's latest attempt per unit makes
  // a re-drive see the real state: `computeReadyUnits` only advances
  // `pending` units, so terminal and parked units are left exactly as the
  // prior drive left them. A first drive has no journal history and falls
  // back to the stored status, unchanged from before.
  const statusById = new Map<string, WorkUnitAttemptStatus>();
  for (const unit of options.workUnits) {
    // Scoped to THIS run's own attempts, not every attempt for the unit id.
    // Work-unit ids are stable across runs of the same change set (a retry
    // is a fresh run over the same, registry-stored units), so a
    // workUnitId-only lookup would seed a retry RUN from the PRIOR run's
    // journal — skipping the very failed work the retry exists to redo. The
    // same run-scoping the attempt cache key needed (its own review's F2).
    // A resume of the same run keeps the same runId, so it still sees its
    // own prior attempts; a fresh run has none and falls back to stored.
    // `countPriorDispatches` (`./attempt-policy.ts`) is run-scoped the same
    // way, so a retry as a genuinely new run both re-selects its units AND
    // gets its own repair budget — it runs to completion, not refused.
    const latest = await getLatestAttemptForRun(deps.journal, unit.id, options.runId);
    // A latest status of `dispatched` at drive ENTRY can only be a PRIOR
    // drive of THIS run that crashed before reaching a terminal status (this
    // drive has dispatched nothing yet). Treat it as `failed`: a crashed
    // attempt is terminal for this loop, so it is not silently re-run and it
    // classifies the run as `blocked`/`failed` rather than a false
    // `completed`. Deliberate re-execution is 13's evidence-gated repair
    // path (`resumeAttempt`), never this loop.
    const seeded = latest?.status ?? unit.attemptStatus;
    statusById.set(unit.id, seeded === "dispatched" ? "failed" : seeded);
  }
  const outcomes: UnitAttemptOutcome[] = [];
  const unitById = new Map(options.workUnits.map((unit) => [unit.id, unit]));

  let rounds = 0;
  let globallyPaused = false;
  const finish = (stopped: DriveRunStopReason): DriveRunResult => ({
    statusById,
    outcomes,
    stopped,
    rounds,
  });

  /**
   * No unit is ready — classify why. A parked unit is NOT terminal (it is
   * retained and resumable), so a run holding one is `parked`, never
   * `completed`; a pending-but-never-ready unit means an upstream
   * dependency failed or was cancelled.
   */
  const classifyIdleRun = (): DriveRunStopReason => {
    const statuses = [...statusById.values()];
    if (statuses.includes("parked:rate_limit")) return "parked";
    if (statuses.includes("pending")) return "blocked";
    return "completed";
  };

  /**
   * Resumes every rate-limit-parked unit whose reset window has passed, via
   * the injected seam, folding each outcome back into `statusById`. Returns
   * the ids it resumed this round. A `parkResume` never consumes repair
   * budget (`attempt-policy.ts`'s `previousStatus` exclusion), so a unit that
   * parks again is simply parked again — the `maxRounds` backstop bounds a
   * pathological park→resume→park cycle.
   */
  const resumeReadyParkedUnits = async (): Promise<readonly string[]> => {
    if (deps.resumeParkedUnit === undefined) return [];
    const resumed: string[] = [];
    for (const unit of options.workUnits) {
      if (statusById.get(unit.id) !== "parked:rate_limit") continue;
      const park = await getParkStatus(deps.journal, unit.id, nowSeconds());
      if (!park.parked || !park.readyToResume || park.sessionId === undefined) continue;
      try {
        const outcome = await deps.resumeParkedUnit(
          {
            workUnit: unit,
            model: resolveModel(unit.role),
            runId: options.runId,
            changeSetId: options.changeSetId,
          },
          park.sessionId,
        );
        // `undefined` = the caller could not resume it (no retained adapter,
        // e.g. after a daemon restart) and declined rather than resume into a
        // read-only session — leave it parked.
        if (outcome === undefined) continue;
        statusById.set(unit.id, statusForOutcome(outcome));
        outcomes.push({ workUnitId: unit.id, outcome });
        resumed.push(unit.id);
      } catch (err) {
        // An account-wide pause re-established while resuming refuses at the
        // executor's own gate — leave the unit parked, exactly as the fresh
        // dispatch path does, rather than crash the drive.
        if (err instanceof GlobalPauseActiveError) continue;
        throw err;
      }
    }
    return resumed;
  };

  for (;;) {
    const ready = computeReadyUnits({ workUnits: options.workUnits, statusById, overlapVerdicts });
    if (ready.length === 0) {
      // No FRESH unit is ready — but a parked unit's reset window may have
      // passed. Resuming it is the difference between a run that continues
      // once the rate limit clears and one that sits parked forever.
      const resumed = await resumeReadyParkedUnits();
      if (resumed.length === 0) return finish(classifyIdleRun());
      rounds += 1;
      if (rounds >= maxRounds) return finish("roundLimit");
      continue;
    }

    if (rounds >= maxRounds) return finish("roundLimit");

    // Checked BEFORE any adapter/worktree is constructed for this round.
    // `dispatchAttempt` enforces the same gate itself (and the catch below
    // still covers a pause established concurrently mid-round), but
    // discovering it here avoids standing up a worktree and an engine
    // process for a dispatch that is going to be refused anyway.
    if (await isGloballyPaused(deps.journal, nowSeconds())) return finish("parked");
    rounds += 1;

    const selected = selectDispatchSet(ready, overlapVerdicts, concurrencyCap);
    await journalFanoutRationaleIfFannedOut({
      journal: deps.journal,
      dispatchedUnitIds: selected,
      runId: options.runId,
      changeSetId: options.changeSetId,
    });

    const roundOutcomes = await Promise.all(
      selected.map(async (unitId) => {
        const workUnit = unitById.get(unitId);
        /* c8 ignore next -- unreachable: every selected id came from options.workUnits */
        if (workUnit === undefined) throw new Error(`run driver: unknown work unit "${unitId}"`);
        try {
          const outcome = await runOneAttempt(
            {
              workUnit,
              model: resolveModel(workUnit.role),
              runId: options.runId,
              changeSetId: options.changeSetId,
            },
            deps,
          );
          return { workUnitId: unitId, outcome };
        } catch (err) {
          // An account-wide pause established by ANY unit (this run's or
          // another's) refuses dispatch at the executor's own gate. That is
          // a resumable condition, not a daemon-fatal one: leave the unit
          // pending so a later run picks it up once the window resets.
          if (err instanceof GlobalPauseActiveError) return { workUnitId: unitId };
          throw err;
        }
      }),
    );

    for (const entry of roundOutcomes) {
      if (entry.outcome === undefined) {
        globallyPaused = true;
        continue;
      }
      statusById.set(entry.workUnitId, statusForOutcome(entry.outcome));
      outcomes.push({ workUnitId: entry.workUnitId, outcome: entry.outcome });
    }

    if (globallyPaused) return finish("parked");
  }
}
