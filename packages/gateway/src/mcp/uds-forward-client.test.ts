import { createServer, type Server, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forwardToSupervisor, UdsForwardError } from "./uds-forward-client.js";

/**
 * A minimal fake UDS peer speaking the SAME wire shape 05's real
 * supervisor speaks (handshake, then one correlated request/response) —
 * deliberately reimplemented here rather than importing `@eo/supervisor`
 * (which exports nothing publicly yet — see `uds-forward-client.ts`'s own
 * doc comment).
 */
function startFakePeer(
  socketPath: string,
  handleRequest: (
    op: string,
    params: unknown,
  ) => { ok: boolean; result?: unknown; error?: { code: string; message: string } },
  options: { rejectHandshake?: boolean } = {},
): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((socket: Socket) => {
      const lines = createInterface({ input: socket, crlfDelay: Infinity });
      let stage: "handshake" | "request" = "handshake";
      lines.on("line", (line) => {
        if (stage === "handshake") {
          stage = "request";
          if (options.rejectHandshake === true) {
            socket.write(
              `${JSON.stringify({ type: "handshake_ack", protocolVersion: 1, accepted: false, reason: "nope" })}\n`,
            );
            socket.end();
            return;
          }
          socket.write(
            `${JSON.stringify({ type: "handshake_ack", protocolVersion: 1, accepted: true })}\n`,
          );
          return;
        }
        const request = JSON.parse(line) as { id: string; op: string; params: unknown };
        const outcome = handleRequest(request.op, request.params);
        socket.write(`${JSON.stringify({ type: "response", id: request.id, ...outcome })}\n`);
      });
    });
    server.listen(socketPath, () => resolve(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("forwardToSupervisor", () => {
  let dir: string;
  let socketPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eo-gateway-uds-forward-"));
    socketPath = join(dir, "control.sock");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("forwards run.status and returns the peer's response", async () => {
    const server = await startFakePeer(socketPath, (op, params) => {
      expect(op).toBe("run.status");
      expect(params).toEqual({ runId: "run-1" });
      return { ok: true, result: { run: { runId: "run-1", runState: "running" } } };
    });

    try {
      const response = await forwardToSupervisor(socketPath, "run.status", { runId: "run-1" });
      expect(response.ok).toBe(true);
      expect(response.result).toEqual({ run: { runId: "run-1", runState: "running" } });
    } finally {
      await closeServer(server);
    }
  });

  it("forwards run.cancel and surfaces an error response", async () => {
    const server = await startFakePeer(socketPath, () => ({
      ok: false,
      error: { code: "NOT_FOUND", message: "no such run" },
    }));

    try {
      const response = await forwardToSupervisor(socketPath, "run.cancel", { runId: "unknown" });
      expect(response.ok).toBe(false);
      expect(response.error).toEqual({ code: "NOT_FOUND", message: "no such run" });
    } finally {
      await closeServer(server);
    }
  });

  it("throws UdsForwardError when the handshake is rejected", async () => {
    const server = await startFakePeer(socketPath, () => ({ ok: true }), { rejectHandshake: true });

    try {
      await expect(
        forwardToSupervisor(socketPath, "run.status", { runId: "x" }),
      ).rejects.toBeInstanceOf(UdsForwardError);
    } finally {
      await closeServer(server);
    }
  });

  it("throws UdsForwardError when connecting to a nonexistent socket", async () => {
    await expect(
      forwardToSupervisor(join(dir, "does-not-exist.sock"), "run.status", { runId: "x" }),
    ).rejects.toThrow();
  });
});
