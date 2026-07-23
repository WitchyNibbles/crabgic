/**
 * UDS forward client — roadmap/16-gateway-core.md §Interfaces consumed,
 * "From 05 (`packages/supervisor`)": "Contract-typed router ops
 * `run.status`/`run.cancel`... this phase's MCP-visible `run.status`/
 * `run.cancel` tools are forwards over UDS to these, never a second
 * implementation." Work item 5.
 *
 * `@eo/supervisor` exports NOTHING from its public barrel yet (its
 * `src/index.ts` is `export {}` at the time this phase lands — 05's UDS
 * wire protocol/codec modules are internal-only, reachable solely as
 * runtime peers over the socket file, never as an importable module: 05's
 * own trust-boundary description names the gateway as one of exactly two
 * local peers admitted to the socket, alongside the CLI, both of which
 * connect as a socket peer, never via `import "@eo/supervisor"`). This
 * module therefore implements its OWN minimal, compatible ndjson
 * request/response client against the wire shape 05's own
 * `docs/ipc-protocol.md` describes (handshake, then correlated
 * request/response envelopes) — a necessary, documented duplication until
 * 05 (or 23's final wiring pass) exports a shared client, exactly the kind
 * of gap this phase's own Risks section flags for the reconciler.
 */

import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";

const PROTOCOL_VERSION = 1;

export class UdsForwardError extends Error {
  constructor(message: string) {
    super(`UDS forward: ${message}`);
    this.name = "UdsForwardError";
    Object.freeze(this);
  }
}

export interface UdsForwardResponse {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface UdsForwardClientOptions {
  readonly clientName?: string;
  readonly connect?: (socketPath: string) => Socket;
}

/**
 * Opens one short-lived connection, performs the handshake, issues exactly
 * one request, and closes. Simple-but-sufficient for a low-frequency
 * `run.status`/`run.cancel` forward — a connection-pooling variant is a
 * drop-in future optimization, not required by this phase's own exit
 * criteria.
 */
export async function forwardToSupervisor(
  socketPath: string,
  op: string,
  params: Readonly<Record<string, unknown>>,
  options: UdsForwardClientOptions = {},
): Promise<UdsForwardResponse> {
  const connect = options.connect ?? ((path: string) => createConnection(path));
  const socket = connect(socketPath);

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });

    const lines = createInterface({ input: socket, crlfDelay: Infinity });
    const iterator = lines[Symbol.asyncIterator]();

    socket.write(
      `${JSON.stringify({
        type: "handshake",
        protocolVersion: PROTOCOL_VERSION,
        clientName: options.clientName ?? GATEWAY_MCP_SERVER_NAME,
      })}\n`,
    );
    const handshakeLine = await iterator.next();
    if (handshakeLine.done || handshakeLine.value === undefined) {
      throw new UdsForwardError("connection closed before handshake ack arrived");
    }
    const ack = JSON.parse(handshakeLine.value) as { accepted?: boolean; reason?: string };
    if (ack.accepted !== true) {
      throw new UdsForwardError(`handshake rejected: ${ack.reason ?? "unknown reason"}`);
    }

    const requestId = randomUUID();
    socket.write(`${JSON.stringify({ type: "request", id: requestId, op, params })}\n`);
    const responseLine = await iterator.next();
    if (responseLine.done || responseLine.value === undefined) {
      throw new UdsForwardError("connection closed before a response arrived");
    }
    return JSON.parse(responseLine.value) as UdsForwardResponse;
  } finally {
    socket.end();
  }
}
