/**
 * The UDS control-plane server — roadmap/05-supervisor-daemon.md §UDS
 * control plane: "ndjson request/response plus server-push events; socket
 * `0600` inside a `0700` runtime dir; `SO_PEERCRED` uid check as the trust
 * boundary; versioned handshake rejects a mismatched protocol version
 * before serving a request." Per-connection ordering, matching every exit
 * criterion this phase owns:
 *
 *   1. peer-auth (`../peer-auth/peer-auth-middleware.js`) — a foreign uid
 *      is refused BEFORE anything else on this connection, including the
 *      handshake itself.
 *   2. handshake (`../protocol/handshake.js`) — a mismatched protocol
 *      version is rejected before any `request` is ever dispatched.
 *   3. router dispatch (`../router/router.js`) — every subsequent line is
 *      parsed as a `RequestEnvelope` and dispatched through the SAME
 *      router instance regardless of which trusted peer (CLI or gateway)
 *      is connected — "one handler set, two transports."
 *
 * Line framing is bounded (`../protocol/line-framer.js`'s `MAX_LINE_BYTES`
 * cap): an admitted (same-uid, already-trusted) peer is still an unbounded
 * input source — a newline-less multi-GB stream from it must not buffer
 * without limit. `frameSocketLines` below feeds raw socket chunks through
 * the pure, capped framer; a `LineTooLongError` (from either the initial
 * handshake read or the request loop) is caught once, in `handleConnection`,
 * and destroys the connection rather than reading further.
 */
import type { Socket } from "node:net";
import { createControlSocketServer, ensureRuntimeDir } from "../runtime/runtime-dir.js";
import { authenticatePeer, type PeerAuthOptions } from "../peer-auth/peer-auth-middleware.js";
import { evaluateHandshakeLine, HandshakeProtocolError } from "../protocol/handshake.js";
import { encodeMessageToLine, tryDecodeMessageLine } from "../protocol/ndjson-message-codec.js";
import { createLineFramer, LineTooLongError } from "../protocol/line-framer.js";
import { buildErrorResponse, buildOkResponse } from "../protocol/wire-schema.js";
import type { SupervisorRouter } from "../router/router.js";

export interface SupervisorServerOptions {
  readonly runtimeDir: string;
  readonly socketPath: string;
  readonly router: SupervisorRouter;
  readonly peerAuth: PeerAuthOptions;
  /** Observability hook — never throws into the caller; connection handling errors are otherwise swallowed per-connection so one bad peer can never take down the server. */
  readonly onConnectionError?: (err: Error) => void;
}

export interface SupervisorServer {
  readonly socketPath: string;
  /**
   * Stops accepting AND disconnects every already-admitted peer, then
   * resolves.
   *
   * `net.Server.close` alone only does the first half: its callback fires
   * only once every established connection has ended, and `net.Server` has no
   * `closeAllConnections` (that member is `http.Server`-only; `getConnections`
   * merely counts). So this module tracks the accepted sockets itself and
   * destroys them, exactly as Node's own `http.Server.closeAllConnections`
   * does.
   *
   * `../compose/boot-supervisor.ts` awaits this as step (a) of shutdown,
   * BEFORE the dispatcher drain and the lease decision. A single idle peer —
   * `crabgic status --watch`, an attached gateway — waited on here made the
   * whole graceful sequence unreachable: no drain, no lease hand-back, no
   * `onShutdown`, and eventually the SIGKILL-mid-drive that the sequence
   * exists to prevent.
   *
   * A peer with an RPC in flight loses its response. That is the deliberate
   * trade: the control socket carries short requests, while the WORK is
   * protected by the dispatcher drain that this step used to make
   * unreachable.
   */
  close(): Promise<void>;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Reads raw chunks off `socket` and yields complete ndjson lines through
 * the pure, `MAX_LINE_BYTES`-capped `createLineFramer` — the same cap the
 * ring buffer's own byte scale uses (see `../protocol/line-framer.js`'s
 * doc comment). A `for await` early-throw (from `framer.push` exceeding
 * the cap) automatically signals the underlying socket async-iterator to
 * clean up; `handleConnection` below still explicitly `destroy()`s the
 * socket for immediacy and clarity.
 */
async function* frameSocketLines(socket: Socket): AsyncGenerator<string, void, void> {
  const framer = createLineFramer();
  for await (const chunk of socket as AsyncIterable<Buffer>) {
    const lines = framer.push(chunk);
    for (const line of lines) {
      yield line;
    }
  }
}

async function handleConnection(socket: Socket, options: SupervisorServerOptions): Promise<void> {
  const authResult = await authenticatePeer(socket, options.peerAuth);
  if (!authResult.admitted) {
    // Refused before any request is served — no handshake, no data read.
    socket.destroy();
    return;
  }

  try {
    await serveConnection(socket, options);
  } catch (err) {
    if (err instanceof LineTooLongError) {
      // A same-uid, already-trusted peer that never frames a line within
      // the cap is treated as a protocol violation — reject/close rather
      // than buffer further.
      socket.destroy(err);
      return;
    }
    throw err;
  }
}

async function serveConnection(socket: Socket, options: SupervisorServerOptions): Promise<void> {
  const iterator = frameSocketLines(socket);

  const first = await iterator.next();
  if (first.done) {
    socket.end();
    return;
  }

  let handshake;
  try {
    handshake = evaluateHandshakeLine(first.value);
  } catch (err) {
    if (err instanceof HandshakeProtocolError) {
      socket.destroy();
      return;
    }
    throw err;
  }

  socket.write(encodeMessageToLine(handshake.ack));
  if (!handshake.accepted) {
    // Mismatched protocol version — rejected before any request is served.
    socket.end();
    return;
  }

  for (;;) {
    const { value, done } = await iterator.next();
    if (done) break;

    const decoded = tryDecodeMessageLine(value);
    if (!decoded.ok || decoded.message === undefined || decoded.message.type !== "request") {
      // This transport only accepts `request` lines from a client after
      // the handshake — anything else is silently ignored rather than
      // tearing down an otherwise-healthy connection over one bad line.
      continue;
    }

    const request = decoded.message;
    try {
      const result = await options.router.dispatch(request.op, request.params);
      socket.write(encodeMessageToLine(buildOkResponse(request.id, result)));
    } catch (err) {
      socket.write(
        encodeMessageToLine(buildErrorResponse(request.id, "DISPATCH_ERROR", toErrorMessage(err))),
      );
    }
  }
}

/** Starts the UDS control-plane server: hardens the runtime dir + socket perms (WI1), then serves connections through peer-auth -> handshake -> router dispatch (WI2). */
export async function startSupervisorServer(
  options: SupervisorServerOptions,
): Promise<SupervisorServer> {
  await ensureRuntimeDir(options.runtimeDir);

  // Every accepted connection, so `close()` can end them. `net.Server` keeps
  // no reachable set of its own and its `close()` waits on all of them, which
  // makes an untracked peer an unclosable server.
  const connections = new Set<Socket>();

  const server = await createControlSocketServer(options.socketPath, (socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
    handleConnection(socket, options).catch((err: unknown) => {
      options.onConnectionError?.(err instanceof Error ? err : new Error(toErrorMessage(err)));
    });
  });

  return {
    socketPath: options.socketPath,
    close: () =>
      new Promise<void>((resolve) => {
        // Order is the guarantee, and both statements run in the same tick:
        // stop accepting FIRST, so nothing can be admitted into the set after
        // the loop below has emptied it. `destroy()` rather than `end()` — a
        // half-close leaves the connection open until the peer sends its own
        // FIN, which an idle peer never does.
        server.close(() => resolve());
        for (const socket of connections) {
          socket.destroy();
        }
      }),
  };
}
