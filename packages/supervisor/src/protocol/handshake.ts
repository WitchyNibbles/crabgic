/**
 * Versioned handshake — pure evaluator (roadmap/05-supervisor-daemon.md
 * work item 1: "versioned handshake rejects a mismatched protocol version
 * before serving a request"). Deliberately has NO socket/timer/I-O
 * dependency of its own: `evaluateHandshakeLine` takes exactly the raw
 * first ndjson line a client sent and returns the `HandshakeAck` to write
 * back plus whether the connection may proceed — the thin I/O shell that
 * reads the actual first line off a real `net.Socket` and decides whether
 * to keep serving afterward lives in `../socket/uds-server.ts`, which is
 * this module's only intended caller.
 */

import { HandshakeRequestSchema, PROTOCOL_VERSION, type HandshakeAck } from "./wire-schema.js";

export class HandshakeProtocolError extends Error {
  constructor(cause: string) {
    super(`supervisor: malformed handshake line (${cause})`);
    this.name = "HandshakeProtocolError";
  }
}

export interface HandshakeEvaluation {
  readonly ack: HandshakeAck;
  readonly accepted: boolean;
  readonly clientProtocolVersion: number;
  readonly clientName: string;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Parses+validates `rawLine` as a `HandshakeRequest` and decides
 * accept/reject against this server's own `PROTOCOL_VERSION`. Throws
 * `HandshakeProtocolError` for a line that isn't even a well-formed
 * handshake request (never silently treated as "reject" — malformed input
 * is a distinct failure mode from a well-formed-but-mismatched version).
 */
export function evaluateHandshakeLine(rawLine: string): HandshakeEvaluation {
  let request;
  try {
    const parsed: unknown = JSON.parse(rawLine);
    request = HandshakeRequestSchema.parse(parsed);
  } catch (err) {
    throw new HandshakeProtocolError(toErrorMessage(err));
  }

  const accepted = request.protocolVersion === PROTOCOL_VERSION;
  const ack: HandshakeAck = accepted
    ? { type: "handshake_ack", protocolVersion: PROTOCOL_VERSION, accepted: true }
    : {
        type: "handshake_ack",
        protocolVersion: PROTOCOL_VERSION,
        accepted: false,
        reason: `protocol version mismatch: server=${PROTOCOL_VERSION}, client=${request.protocolVersion}`,
      };

  return {
    ack,
    accepted,
    clientProtocolVersion: request.protocolVersion,
    clientName: request.clientName,
  };
}
