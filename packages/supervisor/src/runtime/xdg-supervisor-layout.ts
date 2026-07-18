/**
 * Supervisor runtime-dir/socket/registries layout — roadmap/05-supervisor-
 * daemon.md §In scope, "Runtime/state location": "the UDS socket, its
 * `0700` runtime dir, and the registries nest under 04's pinned
 * `$XDG_STATE_HOME/engineering-orchestrator/<project-hash>/` root as a
 * SIBLING subpath alongside 04's own `journal/` and `leases/` — never a
 * second, parallel root, matching the convention 07's `git-control/` and
 * 12's `capability-store/` already follow under 04's `$XDG_CACHE_HOME`
 * sibling."
 *
 * This module NEVER re-derives `resolveStateRoot`/`resolveXdgStateHome`
 * itself — both are imported directly from `@eo/journal` (04's sole
 * definition site, interface-ledger Gap 14). It only adds the one new
 * subdirectory name this phase owns: `supervisor/`, nested exactly like
 * `journal/`/`leases/` are.
 */

import { join } from "node:path";
import { resolveStateRoot, type XdgEnv } from "@eo/journal";

export type { XdgEnv } from "@eo/journal";
export { readXdgEnvFromProcess, resolveStateRoot } from "@eo/journal";

/** Sibling subdirectory name under the pinned state root — alongside `journal/`, `leases/`. */
export const SUPERVISOR_STATE_SUBDIR = "supervisor";

/** Subdirectory names nested under `supervisor/` itself — this package's own organizational choice. */
export const SUPERVISOR_RUN_SUBDIR = "run";
export const SUPERVISOR_REGISTRIES_SUBDIR = "registries";

/** The UDS control-plane socket's file name inside the runtime dir. */
export const SUPERVISOR_SOCKET_FILE_NAME = "control.sock";

/** Permission mode for the runtime dir housing the socket — `0700` (roadmap/05 §UDS control plane). */
export const SUPERVISOR_RUNTIME_DIR_MODE = 0o700;

/** Permission mode for the UDS socket file itself — `0600` (roadmap/05 §UDS control plane). */
export const SUPERVISOR_SOCKET_MODE = 0o600;

/** `.../supervisor/` under the pinned state root — the sibling subpath this phase owns. */
export function resolveSupervisorDir(env: XdgEnv, projectHash: string): string {
  return join(resolveStateRoot(env, projectHash), SUPERVISOR_STATE_SUBDIR);
}

/** `.../supervisor/run/` — the `0700` runtime dir housing the UDS socket. */
export function resolveSupervisorRuntimeDir(env: XdgEnv, projectHash: string): string {
  return join(resolveSupervisorDir(env, projectHash), SUPERVISOR_RUN_SUBDIR);
}

/** `.../supervisor/run/control.sock` — the `0600` UDS control-plane socket path. */
export function resolveSupervisorSocketPath(env: XdgEnv, projectHash: string): string {
  return join(resolveSupervisorRuntimeDir(env, projectHash), SUPERVISOR_SOCKET_FILE_NAME);
}

/** `.../supervisor/registries/` — where this phase's own registry snapshots (artifact index) may persist, if any. */
export function resolveSupervisorRegistriesDir(env: XdgEnv, projectHash: string): string {
  return join(resolveSupervisorDir(env, projectHash), SUPERVISOR_REGISTRIES_SUBDIR);
}
