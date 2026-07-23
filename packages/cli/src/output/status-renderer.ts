/**
 * `status --watch` event-stream renderer — roadmap/09-cli-and-doctor.md
 * work item 3: "`status --watch` event-stream renderer, incl.
 * `WorkUnitAttemptStatus`-aware rendering. Failing-first: a scripted
 * `parked:rate_limit` event renders distinctly from `running`/`failed`."
 * `docs/ipc-protocol.md` §"Server-push events" leaves concrete event names
 * as "an additive, non-breaking extension point" — this renderer is
 * therefore payload-shape-driven (any event carrying a recognizable
 * `{workUnitId, status}` pair renders as a WorkUnit status line) rather
 * than keyed on one hardcoded event name, so it degrades gracefully ahead
 * of whichever phase (13) finalizes the exact event name.
 */
import { WORK_UNIT_ATTEMPT_STATUSES, type WorkUnitAttemptStatus } from "@eo/contracts";

const STATUS_LABELS: Readonly<Record<WorkUnitAttemptStatus, string>> = {
  pending: "pending",
  dispatched: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
  "parked:rate_limit": "parked (rate limit)",
};

const KNOWN_STATUSES = new Set<string>(WORK_UNIT_ATTEMPT_STATUSES);

function isWorkUnitAttemptStatus(value: unknown): value is WorkUnitAttemptStatus {
  return typeof value === "string" && KNOWN_STATUSES.has(value);
}

export interface WorkUnitStatusEvent {
  readonly workUnitId: string;
  readonly status: WorkUnitAttemptStatus;
}

/** Renders one WorkUnit status line — `parked:rate_limit` is visually and textually distinct from both `dispatched` ("running") and `failed`. */
export function renderWorkUnitStatusLine(event: WorkUnitStatusEvent): string {
  const marker = event.status === "parked:rate_limit" ? "⏸" : event.status === "failed" ? "✗" : event.status === "succeeded" ? "✓" : "•";
  return `${marker} [${event.workUnitId}] ${STATUS_LABELS[event.status]}`;
}

export interface RawServerEvent {
  readonly event: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Renders any server-push event: a recognizable `{workUnitId, status}` payload renders as a status line; anything else renders as a generic, still-human-readable event line — never dropped silently. */
export function renderStatusEvent(raw: RawServerEvent): string {
  const { workUnitId, status } = raw.payload;
  if (typeof workUnitId === "string" && isWorkUnitAttemptStatus(status)) {
    return renderWorkUnitStatusLine({ workUnitId, status });
  }
  return `[event] ${raw.event}: ${JSON.stringify(raw.payload)}`;
}
