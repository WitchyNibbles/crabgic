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
 *
 * PRESENTATION (`docs/presentation-policy.md`). The status markers and hues
 * come from the shared vocabulary rather than being spelled out here, so
 * `status --watch`, the doctor report and the manager session all signpost the
 * same state with the same shape and the same colour. `ctx` defaults to
 * monochrome `text`, which reproduces the exact bytes this renderer emitted
 * before the vocabulary existed — a piped or snapshot-captured run is
 * unaffected; a caller that has resolved an interactive terminal passes the
 * result of `resolvePresentation`, and each line arrives coloured by verdict.
 */
import {
  WORK_UNIT_ATTEMPT_STATUSES,
  type PresentationContext,
  type PresentationGlyphRole,
  type WorkUnitAttemptStatus,
} from "@crabgic/contracts";
import { renderStatusLine } from "./human.js";

const STATUS_LABELS: Readonly<Record<WorkUnitAttemptStatus, string>> = {
  pending: "pending",
  dispatched: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
  "parked:rate_limit": "parked (rate limit)",
};

/**
 * Attempt status to glyph role. `cancelled` maps to `info` rather than
 * `fail`: a cancelled unit did not fail, and marking it with a failure glyph
 * would misreport a clean stop as a defect. In the `text` profile `pending`,
 * `running` and `info` all render `•`, exactly as before — the label carries
 * the distinction there, and the emoji profile carries it visually.
 */
const STATUS_ROLES: Readonly<Record<WorkUnitAttemptStatus, PresentationGlyphRole>> = {
  pending: "pending",
  dispatched: "running",
  succeeded: "ok",
  failed: "fail",
  cancelled: "info",
  "parked:rate_limit": "parked",
};

/**
 * The pre-vocabulary default. Named rather than inlined so both entry points
 * provably share it — a drift between them would silently colour one stream
 * and not the other.
 */
const MONOCHROME_TEXT: PresentationContext = { profile: "text", color: false };

const KNOWN_STATUSES = new Set<string>(WORK_UNIT_ATTEMPT_STATUSES);

function isWorkUnitAttemptStatus(value: unknown): value is WorkUnitAttemptStatus {
  return typeof value === "string" && KNOWN_STATUSES.has(value);
}

export interface WorkUnitStatusEvent {
  readonly workUnitId: string;
  readonly status: WorkUnitAttemptStatus;
}

/** Renders one WorkUnit status line — `parked:rate_limit` is visually and textually distinct from both `dispatched` ("running") and `failed`. */
export function renderWorkUnitStatusLine(
  event: WorkUnitStatusEvent,
  ctx: PresentationContext = MONOCHROME_TEXT,
): string {
  return renderStatusLine(
    STATUS_ROLES[event.status],
    `[${event.workUnitId}] ${STATUS_LABELS[event.status]}`,
    ctx,
  );
}

export interface RawServerEvent {
  readonly event: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Renders any server-push event: a recognizable `{workUnitId, status}` payload renders as a status line; anything else renders as a generic, still-human-readable event line — never dropped silently. */
export function renderStatusEvent(
  raw: RawServerEvent,
  ctx: PresentationContext = MONOCHROME_TEXT,
): string {
  const { workUnitId, status } = raw.payload;
  if (typeof workUnitId === "string" && isWorkUnitAttemptStatus(status)) {
    return renderWorkUnitStatusLine({ workUnitId, status }, ctx);
  }
  return `[event] ${raw.event}: ${JSON.stringify(raw.payload)}`;
}
