/**
 * Limit-parking state machine — roadmap/13-scheduler-packets-context.md
 * §In scope, "Limit parking": "on `limitSignal` (06): park
 * (`WorkUnitAttemptStatus: parked:rate_limit`, session retained — only
 * reachable from, and returning to, `dispatched`) -> backoff past reset
 * window -> re-dispatch via `resume` with the SAME `session_id`;
 * account-wide signals pause globally; parking timers derived from
 * journal (restart-safe)."
 *
 * JOURNAL-DERIVED TIMER (documented deviation): `WorkUnitTransitionPayload
 * Schema` (04's `journal-payloads.ts`, itself typed against 02's closed
 * `JournalEntryType`/`WorkUnitAttemptStatus` unions) carries only `status`
 * /`previousStatus`/`sessionId` — no epoch-timestamp field for a rate-limit
 * RESET time. Neither `@eo/contracts` nor `@eo/journal` may be edited by
 * this phase (per this phase's own build constraints), and `JournalEntry
 * Type` is closed at exactly 13 members (interface-ledger Gap 5) — adding
 * a 14th, dedicated member is out of this phase's authority. This module
 * therefore reuses `adjudication_decision`'s already-generic payload
 * (`decision`/`rationale`/`subjectId`) as the timer's carrier — the SAME
 * precedent `packages/journal/src/store/repair-chain.ts` already
 * establishes for this exact entry type ("`adjudication_decision`'s
 * payload is deliberately generic enough to also carry this package's own
 * internal... report," `journal-payloads.ts`'s own doc comment). The real,
 * correctly-typed `work_unit_transition` entry (`parked:rate_limit`,
 * carrying `sessionId`) remains the PRIMARY, authoritative park record —
 * this `adjudication_decision` entry is a documented, precedented
 * SUPPLEMENT that makes the reset time itself restart-safe/journal-derived,
 * never a substitute for the real transition.
 */

import { z } from "zod";
import {
  getLatestAttempt,
  recordAttempt,
  type JournalStore,
  type WorkUnitAttemptRecord,
} from "@eo/journal";
import { GlobalPauseActiveError } from "./errors.js";

/** The `decision` value this module's park-timer marker entries always carry — never confused with a real adjudication verdict. */
export const RATE_LIMIT_PARK_TIMER_DECISION = "rate_limit_park_timer";

/** A well-known sentinel `subjectId` for an ACCOUNT-WIDE (global) pause, distinct from any real `WorkUnit` id. */
export const GLOBAL_PAUSE_SUBJECT_ID = "00000000-0000-4000-8000-000000000000";

export interface ParkTimerPayload {
  readonly workUnitId: string;
  readonly sessionId: string;
  /** Epoch SECONDS, matching `EngineLimitSignalEvent.resetsAt` (docs/engine-baseline.md §8). */
  readonly resetsAt: number;
}

/**
 * MINOR-4 fix (adversarial-validation round): validates a parsed
 * `ParkTimerPayload` shape — see `parseParkTimerPayload` below, which pairs
 * this with a guarded `JSON.parse` so a malformed/foreign
 * `adjudication_decision` entry that happens to carry the park-timer
 * sentinel `decision` (whether corrupted on disk, or written by
 * unrelated/hostile code sharing this generic entry type) can NEVER throw
 * an untyped `SyntaxError`/shape-mismatch out of `getLatestParkTimer` —
 * "never trust file content," this repo's own boundary-validation rule.
 */
const ParkTimerPayloadSchema = z
  .object({
    workUnitId: z.string(),
    sessionId: z.string(),
    resetsAt: z.number(),
  })
  .strict();

/**
 * Parses `rationale` as a `ParkTimerPayload`, returning `undefined` (never
 * throwing) for anything malformed — invalid JSON, or valid JSON in the
 * wrong shape. See `ParkTimerPayloadSchema`'s own doc comment.
 */
function parseParkTimerPayload(rationale: string): ParkTimerPayload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rationale);
  } catch {
    return undefined;
  }
  const result = ParkTimerPayloadSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

async function recordParkTimer(
  journal: JournalStore,
  subjectId: string,
  payload: ParkTimerPayload,
): Promise<void> {
  await journal.appendEntry({
    type: "adjudication_decision",
    workUnitId: payload.workUnitId,
    payload: {
      decision: RATE_LIMIT_PARK_TIMER_DECISION,
      rationale: JSON.stringify(payload),
      subjectId,
    },
  });
}

/**
 * The latest park-timer marker recorded for `subjectId` (a `WorkUnitId` or
 * `GLOBAL_PAUSE_SUBJECT_ID`) — `undefined` if none exists. Scans in
 * ascending `seq` order and keeps the last match, mirroring `@eo/journal`'s
 * own `getLatestAttempt` convention.
 */
export async function getLatestParkTimer(
  journal: JournalStore,
  subjectId: string,
): Promise<ParkTimerPayload | undefined> {
  let latestSeq = -1;
  let latest: ParkTimerPayload | undefined;
  for await (const entry of journal.queryEntries({ type: "adjudication_decision" })) {
    if (entry.type !== "adjudication_decision") continue;
    if (entry.payload.decision !== RATE_LIMIT_PARK_TIMER_DECISION) continue;
    if (entry.payload.subjectId !== subjectId) continue;
    if (entry.seq <= latestSeq) continue;
    // MINOR-4 fix: a malformed/foreign entry (invalid JSON, or the wrong
    // shape) is skipped entirely — never updates `latest`/`latestSeq` and
    // never throws — so a genuinely valid, earlier-or-later entry is still
    // found normally.
    const parsed = parseParkTimerPayload(entry.payload.rationale);
    if (parsed === undefined) continue;
    latestSeq = entry.seq;
    latest = parsed;
  }
  return latest;
}

export interface ParkWorkUnitOptions {
  readonly journal: JournalStore;
  readonly workUnitId: string;
  readonly sessionId: string;
  /** Epoch seconds (`EngineLimitSignalEvent.resetsAt`). */
  readonly resetsAt: number;
  /** `true` for an account-wide signal (roadmap/13: "account-wide signals pause globally") — additionally records a GLOBAL park timer. */
  readonly accountWide?: boolean;
}

/**
 * Parks a `WorkUnit`: records the real `work_unit_transition` (`parked:
 * rate_limit`, retaining `sessionId`) FIRST, then the journal-derived reset
 * timer marker. If `accountWide` is set, additionally records a GLOBAL
 * park timer (`GLOBAL_PAUSE_SUBJECT_ID`) so `isGloballyPaused` can consult
 * it independent of any one work unit.
 */
export async function parkWorkUnit(options: ParkWorkUnitOptions): Promise<WorkUnitAttemptRecord> {
  const attempt = await recordAttempt(
    options.journal,
    options.workUnitId,
    options.sessionId,
    "parked:rate_limit",
  );
  await recordParkTimer(options.journal, options.workUnitId, {
    workUnitId: options.workUnitId,
    sessionId: options.sessionId,
    resetsAt: options.resetsAt,
  });
  if (options.accountWide === true) {
    await recordParkTimer(options.journal, GLOBAL_PAUSE_SUBJECT_ID, {
      workUnitId: options.workUnitId,
      sessionId: options.sessionId,
      resetsAt: options.resetsAt,
    });
  }
  return attempt;
}

/** `true` iff `nowSeconds` has passed `resetsAt` (epoch seconds, per docs/engine-baseline.md §8). */
export function isPastReset(resetsAt: number, nowSeconds: number): boolean {
  return nowSeconds >= resetsAt;
}

/**
 * `true` iff a global (account-wide) pause is currently active — a global
 * park timer exists AND its reset has not yet passed. Restart-safe: this
 * reads the SAME journal-derived marker `parkWorkUnit`'s `accountWide`
 * path wrote, so it survives a simulated supervisor restart mid-pause.
 */
export async function isGloballyPaused(
  journal: JournalStore,
  nowSeconds: number,
): Promise<boolean> {
  const timer = await getLatestParkTimer(journal, GLOBAL_PAUSE_SUBJECT_ID);
  if (timer === undefined) return false;
  return !isPastReset(timer.resetsAt, nowSeconds);
}

/**
 * MINOR-3 fix (adversarial-validation round): `isGloballyPaused` was
 * exported but never consulted anywhere in the dispatch path — "account-
 * wide signals pause globally" was an unenforced In-scope item. This is
 * the throwing gate `../executor.ts`'s `dispatchAttempt`/`resumeAttempt`
 * now call FIRST, before any spawn/resume, so a dispatch genuinely BLOCKS
 * while an account-wide pause is active (see `GlobalPauseActiveError`,
 * `../errors.ts`).
 */
export async function assertNotGloballyPaused(
  journal: JournalStore,
  nowSeconds: number,
): Promise<void> {
  const timer = await getLatestParkTimer(journal, GLOBAL_PAUSE_SUBJECT_ID);
  if (timer === undefined) return;
  if (!isPastReset(timer.resetsAt, nowSeconds)) {
    throw new GlobalPauseActiveError(timer.resetsAt);
  }
}

/**
 * Whether `workUnitId` is currently parked and, if so, whether its reset
 * has passed (ready to resume) — restart-safe: derives entirely from the
 * journal, never in-memory-only state. Cross-checks the CURRENT latest
 * `work_unit_transition` attempt status (not merely "a park-timer marker
 * exists somewhere in history") — a unit that has since been resumed and
 * moved on (e.g. re-dispatched, succeeded) correctly reports
 * `parked: false` even though an earlier park-timer marker still exists in
 * the journal's history.
 */
export interface ParkStatus {
  readonly parked: boolean;
  readonly readyToResume: boolean;
  readonly sessionId?: string;
  readonly resetsAt?: number;
}

export async function getParkStatus(
  journal: JournalStore,
  workUnitId: string,
  nowSeconds: number,
): Promise<ParkStatus> {
  const latestAttempt = await getLatestAttempt(journal, workUnitId);
  if (latestAttempt === undefined || latestAttempt.status !== "parked:rate_limit") {
    return { parked: false, readyToResume: false };
  }

  const timer = await getLatestParkTimer(journal, workUnitId);
  if (timer === undefined) {
    // Defensive: parkWorkUnit always writes both records together, so this
    // should be unreachable in practice — treat as parked-but-timer-unknown
    // rather than silently reporting "not parked."
    return {
      parked: true,
      readyToResume: false,
      ...(latestAttempt.sessionId !== undefined ? { sessionId: latestAttempt.sessionId } : {}),
    };
  }
  const pastReset = isPastReset(timer.resetsAt, nowSeconds);
  return {
    parked: true,
    readyToResume: pastReset,
    sessionId: timer.sessionId,
    resetsAt: timer.resetsAt,
  };
}
