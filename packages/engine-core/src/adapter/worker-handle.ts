import type { EngineEvent } from "./engine-event.js";
import type { SessionRef } from "./session-ref.js";

/**
 * `WorkerHandle` — `EngineAdapter.spawn`/`resume`'s return type
 * (roadmap/03-envelope-compiler-engine-adapter.md §In scope:
 * "`spawn(packet, profile, adjudicate) -> WorkerHandle`,
 * `resume(sessionRef, adjudicate) -> WorkerHandle`"). `sessionRef` is
 * available synchronously once `spawn`/`resume` returns (mirrors
 * adaptation §4.5: "supervisor-chosen via `--session-id <uuid>`, so the
 * journal knows it before the process starts" — the caller can journal a
 * `session_assignment` entry, see `../../README.md`, immediately). `events`
 * is the typed `EngineEvent` stream (adaptation §5.3's `for await (const
 * msg of query(...))` pattern, normalized into this package's own
 * `EngineEvent` taxonomy).
 */
export interface WorkerHandle {
  readonly sessionRef: SessionRef;
  readonly events: AsyncIterable<EngineEvent>;
}
