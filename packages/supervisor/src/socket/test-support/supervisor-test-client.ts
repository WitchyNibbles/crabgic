/**
 * Test-support-only minimal UDS client (not part of this package's public
 * barrel — 09 owns the real typed client this protocol is written for;
 * roadmap/05 §Interfaces produced: "Consumed by 09 ('this phase's typed
 * client speaks this protocol,' 09's own text)"). Used only by THIS
 * package's own integration tests, over a real socket, no mocked
 * transport.
 */
import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { encodeMessageToLine } from "../../protocol/ndjson-message-codec.js";
import {
  PROTOCOL_VERSION,
  type HandshakeAck,
  type ResponseEnvelope,
} from "../../protocol/wire-schema.js";

export interface TestClient {
  readonly socket: Socket;
  handshake(protocolVersion?: number): Promise<HandshakeAck>;
  request(op: string, params: Readonly<Record<string, unknown>>): Promise<ResponseEnvelope>;
  close(): void;
}

export async function connectTestClient(
  socketPath: string,
  clientName = "test-client",
): Promise<TestClient> {
  const socket = createConnection(socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });

  const lines = createInterface({ input: socket, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();

  return {
    socket,
    async handshake(protocolVersion = PROTOCOL_VERSION): Promise<HandshakeAck> {
      socket.write(encodeMessageToLine({ type: "handshake", protocolVersion, clientName }));
      const { value, done } = await iterator.next();
      if (done || value === undefined) {
        throw new Error("test client: connection closed before handshake ack arrived");
      }
      return JSON.parse(value) as HandshakeAck;
    },
    async request(
      op: string,
      params: Readonly<Record<string, unknown>>,
    ): Promise<ResponseEnvelope> {
      const id = randomUUID();
      socket.write(encodeMessageToLine({ type: "request", id, op, params }));
      const { value, done } = await iterator.next();
      if (done || value === undefined) {
        throw new Error("test client: connection closed before a response arrived");
      }
      return JSON.parse(value) as ResponseEnvelope;
    },
    close(): void {
      socket.end();
    },
  };
}
