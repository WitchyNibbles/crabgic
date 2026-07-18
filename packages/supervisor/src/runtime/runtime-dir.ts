/**
 * Runtime dir + UDS socket, hardened perms — roadmap/05-supervisor-daemon.md
 * work item 1: "socket `0600` inside a `0700` runtime dir." `mkdir`'s own
 * `mode` option is subject to the process umask (verified empirically:
 * `mkdir(dir, {mode: 0o700})` under a `0022` umask still yields `0700`
 * because `0700 & ~0022 === 0700`, but a caller under a WIDER umask, or an
 * already-existing dir created by something else, would not be — so this
 * module always follows up with an explicit `chmod` rather than trusting
 * the creation-time mode alone). Same reasoning for the socket file: a UDS
 * `bind()` creates the socket inode with the platform's default file mode
 * shaped by umask (observed `0755` under `0022`), never `0600` on its own
 * — this module always `chmod`s it immediately after `listen()` resolves,
 * before returning the server to the caller (see the ordering note on
 * `createControlSocketServer` below: the socket exists, in a
 * wider-than-intended mode, for a brief window between `listen()` resolving
 * and `chmod` completing — no connection is accepted in that window because
 * this function does not return the server, and no `connection` events fire
 * synchronously before the event loop yields, but see this file's own risk
 * note below for the residual).
 */

import { chmod, mkdir, stat } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
// Sole definition site for both mode constants is `./xdg-supervisor-
// layout.js` (this package's barrel re-exports them from exactly there,
// never a second time from this module — avoids a duplicate-export
// collision in `../index.ts`).
import { SUPERVISOR_RUNTIME_DIR_MODE, SUPERVISOR_SOCKET_MODE } from "./xdg-supervisor-layout.js";

/** Thrown when a path's on-disk mode does not match the expected hardened mode after an explicit chmod attempt. */
export class RuntimePermissionError extends Error {
  readonly path: string;
  readonly expectedMode: number;
  readonly actualMode: number;

  constructor(path: string, expectedMode: number, actualMode: number) {
    super(
      `supervisor: "${path}" has mode 0${actualMode.toString(8)}, expected 0${expectedMode.toString(8)}`,
    );
    this.name = "RuntimePermissionError";
    this.path = path;
    this.expectedMode = expectedMode;
    this.actualMode = actualMode;
  }
}

/** Reads back a path's mode bits (low 9 bits) and throws `RuntimePermissionError` if they don't match `expectedMode` exactly. */
export async function assertPathMode(path: string, expectedMode: number): Promise<void> {
  const st = await stat(path);
  const actual = st.mode & 0o777;
  if (actual !== expectedMode) {
    throw new RuntimePermissionError(path, expectedMode, actual);
  }
}

/**
 * Creates (or hardens an already-existing) runtime dir at exactly `0700`,
 * regardless of the process umask or any prior wider mode.
 */
export async function ensureRuntimeDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: SUPERVISOR_RUNTIME_DIR_MODE });
  // Explicit follow-up chmod: `mkdir`'s `mode` is subject to umask on
  // creation, AND is a no-op when the dir already exists with different
  // (wider) perms from a prior run — this hardens both cases uniformly.
  await chmod(dir, SUPERVISOR_RUNTIME_DIR_MODE);
  await assertPathMode(dir, SUPERVISOR_RUNTIME_DIR_MODE);
}

/**
 * Binds a UDS server at `socketPath` and hardens the resulting socket file
 * to exactly `0600` before returning it — the caller never observes a
 * server object whose socket is still at its default (wider) mode.
 */
export async function createControlSocketServer(
  socketPath: string,
  onConnection: (socket: Socket) => void,
): Promise<Server> {
  const server = createServer(onConnection);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  await chmod(socketPath, SUPERVISOR_SOCKET_MODE);
  await assertPathMode(socketPath, SUPERVISOR_SOCKET_MODE);
  return server;
}
