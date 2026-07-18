/**
 * Real `SO_PEERCRED` read on Linux — roadmap/05-supervisor-daemon.md work
 * item 2: "`SO_PEERCRED` peer-auth middleware admitting ONLY the invoking
 * uid's own processes... real SO_PEERCRED read on Linux via socket
 * options."
 *
 * Node's `net` module exposes no `getsockopt` binding of its own — there is
 * no pure-JS, no-native-addon way to read a UNIX-domain peer's kernel-
 * enforced credentials (verified directly: `/proc/self/fdinfo/<fd>` for an
 * AF_UNIX socket carries no peer-identity field on this kernel; the
 * documented mechanism is exactly `getsockopt(fd, SOL_SOCKET, SO_PEERCRED,
 * &ucred)`). Building a native (N-API) addon would need `npm install`
 * (node-gyp + its toolchain), which this phase may not run. This module
 * instead hands the accepted connection's own raw fd
 * (`(socket)._handle.fd`) to a short-lived `python3` subprocess as fd 3 —
 * Node's documented `stdio` array numeric-fd-passing mechanism dup()s the
 * fd; the parent's own fd is untouched and the socket keeps working
 * immediately afterward (verified empirically before this module was
 * written). Python's own `socket` stdlib module then calls the genuine
 * kernel `getsockopt(SOL_SOCKET, SO_PEERCRED)` and prints the resulting
 * `{pid,uid,gid}` struct as one line of JSON, which this module parses.
 * See `../../README.md`'s deviations section for this decision recorded in
 * full, including the fail-closed posture below if `python3` is
 * unavailable.
 *
 * This real reader is injected behind `PeerCredentialReader` precisely so
 * `../peer-auth-middleware.ts`'s own unit/property tests never need to
 * spawn a real subprocess — "simulate by injecting the peer uid" (roadmap/05
 * work item 2's own failing-first framing). A dedicated integration test
 * (`peer-credentials.test.ts`) exercises THIS real reader directly, over a
 * real self-connected UDS socket, asserting it reads back this process's
 * own `process.getuid()`.
 */

import { spawn } from "node:child_process";
import type { Socket } from "node:net";

export interface PeerCredentials {
  readonly pid: number;
  readonly uid: number;
  readonly gid: number;
}

/** Injectable strategy `../peer-auth-middleware.ts` depends on — the real Linux implementation below, or a test double. */
export type PeerCredentialReader = (socket: Socket) => Promise<PeerCredentials>;

/** Any failure reading peer credentials — bridge crash, timeout, missing platform support — surfaces as this ONE error type, so callers can fail closed uniformly regardless of cause. */
export class PeerCredentialUnavailableError extends Error {
  constructor(cause: string) {
    super(`supervisor: could not read peer credentials for this UDS connection (${cause})`);
    this.name = "PeerCredentialUnavailableError";
  }
}

const READ_PEER_CRED_PY = [
  "import socket, struct, sys",
  "s = socket.socket(fileno=3)",
  "try:",
  "    creds = s.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i'))",
  "except OSError as e:",
  "    sys.stderr.write(str(e))",
  "    sys.exit(1)",
  "pid, uid, gid = struct.unpack('3i', creds)",
  'sys.stdout.write(\'{"pid":%d,"uid":%d,"gid":%d}\' % (pid, uid, gid))',
].join("\n");

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface RawFdSocket {
  readonly _handle?: { readonly fd?: number };
}

/** Extracts the accepted connection's raw native fd — the same fd number this process itself uses for I/O on this socket; passing it to a child process only `dup()`s it. */
function extractRawFd(socket: Socket): number {
  const fd = (socket as unknown as RawFdSocket)._handle?.fd;
  if (typeof fd !== "number") {
    throw new PeerCredentialUnavailableError("socket has no underlying native fd");
  }
  return fd;
}

const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Spawns `command`/`args` with `fd` duplicated in as fd 3, waits for it to
 * exit, and parses its stdout as one JSON line — the generic child-process-
 * with-timeout-and-JSON-parse mechanics `readPeerCredentialsLinux` below
 * uses with the fixed `python3` SO_PEERCRED script. Extracted as its own,
 * separately unit-testable function (`peer-credentials.test.ts` exercises
 * every failure branch — timeout, non-zero exit, malformed stdout —
 * against trivial `node -e` fixtures, rather than depending on `python3`'s
 * own specific negative-path behavior) so this module's fail-closed
 * posture is proven branch-by-branch, not merely "believed to work."
 */
export async function spawnAndParseJsonLine<T>(
  command: string,
  args: readonly string[],
  fd: number,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe", fd],
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new PeerCredentialUnavailableError(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timeout.unref();

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new PeerCredentialUnavailableError(toErrorMessage(err)));
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(
          new PeerCredentialUnavailableError(
            stderr.trim() || `child process exited with code ${String(code)}`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch (err) {
        reject(new PeerCredentialUnavailableError(toErrorMessage(err)));
      }
    });
  });
}

interface RawPeerCredentialsJson {
  readonly pid: number;
  readonly uid: number;
  readonly gid: number;
}

function isValidPeerCredentialsJson(value: RawPeerCredentialsJson): boolean {
  return (
    typeof value.pid === "number" && typeof value.uid === "number" && typeof value.gid === "number"
  );
}

/** The real Linux `SO_PEERCRED` reader — see this file's own doc comment. Fails closed (rejects) on ANY bridge failure: missing `python3`, non-zero exit, malformed output, or a timeout. */
export async function readPeerCredentialsLinux(
  socket: Socket,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<PeerCredentials> {
  const fd = extractRawFd(socket);
  const parsed = await spawnAndParseJsonLine<RawPeerCredentialsJson>(
    "python3",
    ["-c", READ_PEER_CRED_PY],
    fd,
    timeoutMs,
  );
  if (!isValidPeerCredentialsJson(parsed)) {
    throw new PeerCredentialUnavailableError("malformed peer-credential JSON");
  }
  return { pid: parsed.pid, uid: parsed.uid, gid: parsed.gid };
}
