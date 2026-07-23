/**
 * Typed UDS client — roadmap/09-cli-and-doctor.md §Interfaces produced item
 * 2: "Typed UDS client (parser + contract-typed request/response over 05's
 * protocol) — consumed by 10/11/12 for their own command backends; no phase
 * builds a second client." Speaks exactly `docs/ipc-protocol.md`: connect,
 * send one `handshake` line, expect one `handshake_ack`, then pipeline any
 * number of `request` lines correlated by `id`. This module owns none of
 * the wire schemas themselves — every type/schema it uses is imported
 * directly from `@eo/supervisor` (05's own package), never re-declared.
 */
import { randomUUID } from "node:crypto";
import { connect as netConnect, type Socket } from "node:net";
import {
  createLineFramer,
  decodeMessageLine,
  encodeMessageToLine,
  LineTooLongError,
  PROTOCOL_VERSION,
  tryDecodeMessageLine,
  type ResponseEnvelope,
} from "@eo/supervisor";
import { SupervisorUnavailableError, toErrorMessage } from "../errors.js";

export const CLIENT_NAME = "engineering-orchestrator-cli";

/** A well-formed `response` came back with `ok:false` — the operation itself failed, not the transport. */
export class UdsOperationError extends Error {
  readonly code: string;

  constructor(op: string, code: string, message: string) {
    super(`operation "${op}" failed (${code}): ${message}`);
    this.name = "UdsOperationError";
    this.code = code;
  }
}

export interface UdsClientOptions {
  readonly socketPath: string;
  readonly clientName?: string;
  readonly connectTimeoutMs?: number;
  /**
   * Per-request timeout (adversarial-review fix, 2026-07-24): the prior
   * version only ever timed out `connect()` itself — a server that accepted
   * the connection, completed the handshake, but then never answered a
   * `request` line left `request()` pending forever. Default 30s.
   */
  readonly requestTimeoutMs?: number;
}

export interface UdsClient {
  request<R = unknown>(op: string, params: Record<string, unknown>): Promise<R>;
  onEvent(listener: (event: string, payload: Record<string, unknown>) => void): () => void;
  close(): Promise<void>;
}

interface Pending {
  readonly resolve: (result: unknown) => void;
  readonly reject: (err: Error) => void;
  readonly timer: NodeJS.Timeout;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function connectSocket(socketPath: string, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new SupervisorUnavailableError(`connect timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err: Error) => {
      clearTimeout(timer);
      reject(new SupervisorUnavailableError(toErrorMessage(err)));
    });
  });
}

/**
 * Connects to the supervisor's UDS control socket, performs the versioned
 * handshake, and returns a client whose `request()` pipelines requests
 * correlated by a fresh `id` each call. Throws `SupervisorUnavailableError`
 * for anything before a successful handshake (connect failure, handshake
 * rejection, malformed ack).
 */
export async function connectUdsClient(options: UdsClientOptions): Promise<UdsClient> {
  const timeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const socket = await connectSocket(options.socketPath, timeoutMs);

  const pending = new Map<string, Pending>();
  const eventListeners = new Set<(event: string, payload: Record<string, unknown>) => void>();
  const framer = createLineFramer();
  let closed = false;

  function failAllPending(err: Error): void {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    pending.clear();
  }

  socket.on("data", (chunk: Buffer) => {
    let lines: readonly string[];
    try {
      lines = framer.push(chunk);
    } catch (err) {
      if (err instanceof LineTooLongError) {
        socket.destroy(err);
        return;
      }
      throw err;
    }
    for (const line of lines) {
      const decoded = tryDecodeMessageLine(line);
      if (!decoded.ok || decoded.message === undefined) continue;
      const message = decoded.message;
      if (message.type === "response") {
        const entry = pending.get(message.id);
        if (entry === undefined) continue;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.ok) {
          entry.resolve(message.result);
        } else {
          const error = message.error ?? { code: "UNKNOWN", message: "unknown error" };
          entry.reject(new UdsOperationError("(unknown op)", error.code, error.message));
        }
      } else if (message.type === "event") {
        for (const listener of eventListeners) listener(message.event, message.payload);
      }
    }
  });

  socket.on("close", () => {
    closed = true;
    failAllPending(new SupervisorUnavailableError("connection closed"));
  });
  socket.on("error", (err: Error) => {
    failAllPending(new SupervisorUnavailableError(toErrorMessage(err)));
  });

  // ---- handshake ----
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      let lines: readonly string[];
      try {
        lines = framer.push(chunk);
      } catch (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      if (lines.length === 0) return;
      cleanup();
      try {
        const ack = decodeMessageLine(lines[0]!);
        if (ack.type !== "handshake_ack") {
          reject(new SupervisorUnavailableError(`expected handshake_ack, got "${ack.type}"`));
          return;
        }
        if (!ack.accepted) {
          reject(new SupervisorUnavailableError(ack.reason ?? "handshake rejected"));
          return;
        }
        // Re-dispatch any lines the handshake read past its own ack.
        for (const extra of lines.slice(1)) socket.emit("data", Buffer.from(`${extra}\n`));
        resolve();
      } catch (err) {
        reject(new SupervisorUnavailableError(toErrorMessage(err)));
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(new SupervisorUnavailableError(toErrorMessage(err)));
    };
    function cleanup() {
      socket.off("data", onData);
      socket.off("error", onError);
    }
    socket.on("data", onData);
    socket.once("error", onError);
    socket.write(
      encodeMessageToLine({
        type: "handshake",
        protocolVersion: PROTOCOL_VERSION,
        clientName: options.clientName ?? CLIENT_NAME,
      }),
    );
  });

  return {
    async request<R = unknown>(op: string, params: Record<string, unknown>): Promise<R> {
      if (closed) throw new SupervisorUnavailableError("client is closed");
      const id = randomUUID();
      const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      return new Promise<R>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new SupervisorUnavailableError(`request "${op}" timed out after ${requestTimeoutMs}ms`),
          );
        }, requestTimeoutMs);
        timer.unref?.();
        pending.set(id, {
          resolve: (result) => resolve(result as R),
          reject: (err) => reject(err),
          timer,
        });
        socket.write(encodeMessageToLine({ type: "request", id, op, params }));
      });
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    async close(): Promise<void> {
      closed = true;
      failAllPending(new SupervisorUnavailableError("client closed"));
      await new Promise<void>((resolve) => {
        socket.end(() => resolve());
      });
    },
  };
}

export type { ResponseEnvelope };
