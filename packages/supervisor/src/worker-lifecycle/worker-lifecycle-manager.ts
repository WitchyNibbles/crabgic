/**
 * Worker lifecycle manager — ties this package's own spawn/reap plumbing
 * together: spawn via `EngineAdapter` -> journal `session_assignment`
 * BEFORE consuming any events -> register into `WorkersRegistry` ->
 * `recordAttempt(..., "dispatched")` -> pump `handle.events` into a
 * per-worker ring buffer while watching for a terminal `result` event ->
 * on a clean terminal result, `recordAttempt` the self-reported outcome;
 * on an ABRUPT end (no `result` event, or a thrown iterator) — a crash —
 * mark the worker `crashed`, `recordAttempt(..., "failed")`, and fire the
 * recovery-hook call site (roadmap/05 §Interfaces produced: "Crash-
 * detection → journaled-attempt-record → recovery-hook slot: ... resume/
 * fork policy lands in 06/13; this phase supplies the detection, the
 * record, and the hook's call site, never the policy answering it").
 */
import { randomUUID } from "node:crypto";
import type {
  AdjudicationCallback,
  CompiledWorkerProfile,
  EngineAdapter,
  EngineEvent,
} from "@eo/engine-core";
import type { TaskPacket } from "@eo/contracts";
import { recordAttempt, type JournalStore } from "@eo/journal";
import type { WorkerRecord } from "../router/operations.js";
import type { WorkersRegistry } from "../registries/workers-registry.js";
import { createRingBuffer, type RingBuffer } from "../event-bus/ring-buffer.js";
import { terminateWorker, type TerminationResult } from "./termination-ladder.js";

export type WorkerSettledOutcome = "succeeded" | "failed" | "cancelled" | "crashed";

export type WorkerRecoveryHook = (worker: WorkerRecord, outcome: "crashed") => void | Promise<void>;

export interface SpawnManagedWorkerOptions {
  readonly adapter: EngineAdapter;
  readonly journal: JournalStore;
  readonly workers: WorkersRegistry;
  readonly packet: TaskPacket;
  readonly profile: CompiledWorkerProfile;
  readonly adjudicate: AdjudicationCallback;
  readonly runId?: string;
  /** Recovery-hook call site — fired ONLY on a genuine crash (abrupt stream end), never on a clean failed/cancelled result. Default no-op. */
  readonly onCrash?: WorkerRecoveryHook;
  readonly now?: () => Date;
}

export interface ManagedWorker {
  readonly workerId: string;
  readonly sessionId: string;
  readonly logBuffer: RingBuffer;
  /** Resolves once the worker's own event stream has settled, one way or another. */
  readonly settled: Promise<WorkerSettledOutcome>;
  terminate(graceMs: number): Promise<TerminationResult>;
}

function isTerminalOutcome(value: unknown): value is "succeeded" | "failed" | "cancelled" {
  return value === "succeeded" || value === "failed" || value === "cancelled";
}

export async function spawnManagedWorker(
  options: SpawnManagedWorkerOptions,
): Promise<ManagedWorker> {
  const nowFn = options.now ?? ((): Date => new Date());
  const handle = options.adapter.spawn(options.packet, options.profile, options.adjudicate);
  const workerId = randomUUID();
  const sessionId = handle.sessionRef.sessionId;
  const workUnitId = options.packet.workUnitId;

  // Journal session_assignment BEFORE consuming any events off the
  // handle — the earliest point available to this package (spawn() itself
  // must return before the sessionRef is known here at all).
  await options.journal.appendEntry({
    type: "session_assignment",
    ...(options.runId !== undefined ? { runId: options.runId } : {}),
    workUnitId,
    payload: { sessionId },
  });

  options.workers.upsert({
    workerId,
    workUnitId,
    sessionId,
    status: "starting",
    startedAt: nowFn().toISOString(),
  });

  await recordAttempt(options.journal, workUnitId, sessionId, "dispatched");

  const logBuffer = createRingBuffer();
  const iterator = handle.events[Symbol.asyncIterator]();

  const settled = pumpWorkerEvents({
    iterator,
    journal: options.journal,
    workers: options.workers,
    logBuffer,
    workerId,
    workUnitId,
    sessionId,
    onCrash: options.onCrash,
    now: nowFn,
  });

  return {
    workerId,
    sessionId,
    logBuffer,
    settled,
    terminate: (graceMs: number) =>
      terminateWorker({ adapter: options.adapter, handle, iterator, graceMs, now: nowFn }),
  };
}

interface PumpOptions {
  readonly iterator: AsyncIterator<EngineEvent>;
  readonly journal: JournalStore;
  readonly workers: WorkersRegistry;
  readonly logBuffer: RingBuffer;
  readonly workerId: string;
  readonly workUnitId: string;
  readonly sessionId: string;
  readonly onCrash: WorkerRecoveryHook | undefined;
  readonly now: () => Date;
}

async function pumpWorkerEvents(options: PumpOptions): Promise<WorkerSettledOutcome> {
  let sawTerminalResult = false;
  let resultOutcome: "succeeded" | "failed" | "cancelled" = "failed";

  try {
    for (;;) {
      const { value, done } = await options.iterator.next();
      if (done) break;
      await options.logBuffer.push(JSON.stringify(value));
      if (value.type === "result") {
        sawTerminalResult = true;
        const reported = value.structuredOutput?.["outcome"];
        resultOutcome = isTerminalOutcome(reported)
          ? reported
          : value.isError
            ? "failed"
            : "succeeded";
      }
    }
  } catch {
    sawTerminalResult = false; // a thrown iterator is treated identically to an abrupt end
  }

  const nowIso = options.now().toISOString();
  const current = options.workers.get(options.workerId);
  const base: WorkerRecord = current ?? {
    workerId: options.workerId,
    workUnitId: options.workUnitId,
    sessionId: options.sessionId,
    status: "running",
    startedAt: nowIso,
  };

  if (!sawTerminalResult) {
    const crashed: WorkerRecord = { ...base, status: "crashed", terminatedAt: nowIso };
    options.workers.upsert(crashed);
    await recordAttempt(options.journal, options.workUnitId, options.sessionId, "failed");
    await options.onCrash?.(crashed, "crashed");
    return "crashed";
  }

  const terminated: WorkerRecord = { ...base, status: "terminated", terminatedAt: nowIso };
  options.workers.upsert(terminated);
  await recordAttempt(options.journal, options.workUnitId, options.sessionId, resultOutcome);
  return resultOutcome;
}
