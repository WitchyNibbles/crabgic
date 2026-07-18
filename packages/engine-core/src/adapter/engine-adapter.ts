import type { TaskPacket, Timestamp } from "@eo/contracts";
import type { AdjudicationCallback } from "./adjudication.js";
import type { CompiledWorkerProfile } from "../compiler/compiled-worker-profile.js";
import type { EngineCapabilities } from "./engine-capabilities.js";
import type { SessionRef } from "./session-ref.js";
import type { WorkerHandle } from "./worker-handle.js";

/**
 * `EngineAdapter` — the frozen adapter contract this phase defines
 * (roadmap/03-envelope-compiler-engine-adapter.md §In scope,
 * "`EngineAdapter` interface" bullet; §Goal: "a frozen `EngineAdapter`
 * interface exists in `packages/engine-core`"). The only formal consumer
 * within this phase's own dependency edge is phase 06
 * (`packages/engine-claude`, the real SDK-backed implementation); phase
 * 03's own fake-engine-adjacent test doubles (used only inside this
 * package's tests) also implement it to prove the contract is
 * satisfiable — the real scriptable fake engine that phases 05/06 import
 * lives in `packages/testkit` (a different worker's deliverable, roadmap/03
 * work item 5, out of scope here).
 *
 * `TaskPacket`/`Timestamp` are consumed from `@eo/contracts` (phase 02
 * owns both schemas) — never redefined here.
 */
export interface EngineAdapter {
  /**
   * Spawns a new worker for `packet`, confined by the already-compiled
   * `profile` (this package's own `compileEnvelope` output), adjudicating
   * every tool call through `adjudicate`. Returns synchronously — the
   * returned `WorkerHandle.sessionRef` is available immediately (before
   * any `EngineEvent` has been consumed), so the caller can journal a
   * `session_assignment` entry (`../../README.md`) right away.
   */
  spawn(
    packet: TaskPacket,
    profile: CompiledWorkerProfile,
    adjudicate: AdjudicationCallback,
  ): WorkerHandle;

  /**
   * Resumes an existing session (adaptation §4.5, §5.6 — crash recovery
   * and repair-attempt continuation). `sessionRef` is scoped to a project
   * directory and its worktrees; resuming outside that scope is each
   * implementation's own responsibility to reject.
   */
  resume(sessionRef: SessionRef, adjudicate: AdjudicationCallback): WorkerHandle;

  /**
   * Requests cancellation of an in-flight worker by `deadline` (an
   * `@eo/contracts` `Timestamp` — ISO-8601 UTC instant) — the grace period
   * an implementation has before it must force-terminate the underlying
   * process. Resolves once cancellation has been requested/completed;
   * never throws for an already-terminated handle.
   */
  cancel(handle: WorkerHandle, deadline: Timestamp): Promise<void>;

  /**
   * This adapter implementation's capability tuple (interface-ledger Gap
   * 7) — exactly `supportsJsonSchema, supportsSessionResume,
   * permissionModel, sandboxModel, engineVersion`.
   */
  capabilities(): EngineCapabilities;
}
