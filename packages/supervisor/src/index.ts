/**
 * `@eo/supervisor` public barrel — roadmap/05-supervisor-daemon.md. Every
 * cross-cutting type/function this package exposes to phase 06 (real
 * `EngineAdapter`), 09 (CLI, typed client against `docs/ipc-protocol.md`),
 * 11 (`project.inspect`'s registry reads), 13 (dispatch loop driving
 * run-lifecycle transitions), and 16 (gateway `run.status`/`run.cancel`
 * forwarding) is exported from exactly this one module — downstream
 * packages import from `@eo/supervisor` directly, never a submodule path.
 *
 * Excluded deliberately (test-support-only, not part of this package's
 * public API surface): `worker-lifecycle/test-support/*`,
 * `socket/test-support/*`, and `socket/kill-harness-fixtures/*.mjs` — each
 * module's own doc comment says so.
 *
 * A repo-wide export-name collision check (grep-based, mirroring the same
 * check `packages/contracts/src/index.ts`'s and `packages/journal/src/
 * index.ts`'s own barrel doc comments describe) found zero duplicate
 * top-level identifiers across every module re-exported below — two real
 * collisions were found and fixed during this phase's own build
 * (`SUPERVISOR_RUNTIME_DIR_MODE`/`SUPERVISOR_SOCKET_MODE` had been declared
 * in both `runtime/xdg-supervisor-layout.ts` and `runtime/runtime-dir.ts`;
 * `ArtifactIndexEntrySchema`/`WorkUnitAttemptStatusSchema` had redundant
 * second re-export sites) — see `../README.md`'s deviations section.
 */

// ---- Runtime dir + UDS socket (WI1): layout constants/resolvers, hardened dir/socket creation ----
export * from "./runtime/xdg-supervisor-layout.js";
export * from "./runtime/runtime-dir.js";

// ---- UDS wire protocol (WI1): codec, handshake, additive-only golden descriptor ----
export * from "./protocol/wire-schema.js";
export * from "./protocol/ndjson-message-codec.js";
export * from "./protocol/line-framer.js";
export * from "./protocol/handshake.js";
export * from "./protocol/wire-schema-descriptor.js";

// ---- SO_PEERCRED peer-auth middleware (WI2) ----
export * from "./peer-auth/peer-credentials.js";
export * from "./peer-auth/peer-auth-middleware.js";

// ---- Contract-typed router (WI2): operation vocabulary, router class, full dependency wiring ----
export * from "./router/operations.js";
export * from "./router/router.js";
export * from "./router/build-router.js";

// ---- Registries (WI3): runs, change sets, work units, workers, artifact index; recovery ----
export * from "./registries/registry.js";
export * from "./registries/runs-registry.js";
export * from "./registries/change-sets-registry.js";
export * from "./registries/work-units-registry.js";
export * from "./registries/workers-registry.js";
export * from "./registries/artifact-index-registry.js";
export * from "./registries/recovery.js";

// ---- Run-lifecycle transition surface (shared by 11's stop-condition detectors, 13's dispatch loop) ----
export * from "./run-lifecycle/run-transition.js";

// ---- Worker lifecycle mechanics (WI4): provisioning, termination ladder, orphan reaping, the manager tying spawn+journal-tee+crash-detection together ----
export * from "./worker-lifecycle/worker-provisioning.js";
export * from "./worker-lifecycle/termination-ladder.js";
export * from "./worker-lifecycle/orphan-reaper.js";
export * from "./worker-lifecycle/worker-lifecycle-manager.js";

// ---- Journal-teed event bus + adjudication stub (WI5): backpressured ring buffer, fail-closed adjudication bus ----
export * from "./event-bus/ring-buffer.js";
export * from "./event-bus/adjudication-bus.js";

// ---- Idle resource budget probe + heartbeat scheduler (WI6) ----
export * from "./idle-budget/resource-probe.js";
export * from "./idle-budget/heartbeat-scheduler.js";

// ---- The UDS control-plane server itself: peer-auth -> handshake -> router dispatch ----
export * from "./socket/uds-server.js";
