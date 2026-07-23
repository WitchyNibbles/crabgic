import { createServer, type Server, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRunForwardTools } from "./run-forward-tools.js";

function startFakePeer(
  socketPath: string,
  handleRequest: (
    op: string,
    params: unknown,
  ) => { ok: boolean; result?: unknown; error?: { code: string; message: string } },
): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((socket: Socket) => {
      const lines = createInterface({ input: socket, crlfDelay: Infinity });
      let stage: "handshake" | "request" = "handshake";
      lines.on("line", (line) => {
        if (stage === "handshake") {
          stage = "request";
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

describe("buildRunForwardTools", () => {
  let dir: string;
  let socketPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eo-gateway-run-forward-"));
    socketPath = join(dir, "control.sock");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("run.status forwards and surfaces a successful result", async () => {
    const server = await startFakePeer(socketPath, () => ({
      ok: true,
      result: { run: { runId: "run-1", runState: "running" } },
    }));
    try {
      const [status] = buildRunForwardTools({ supervisorSocketPath: socketPath });
      const result = await status?.handler({ runId: "run-1" });
      expect(result?.isError).toBeUndefined();
      expect(JSON.parse(result?.content[0]?.text ?? "{}")).toEqual({
        run: { runId: "run-1", runState: "running" },
      });
    } finally {
      await closeServer(server);
    }
  });

  it("run.status surfaces isError:true for a failed forward", async () => {
    const server = await startFakePeer(socketPath, () => ({
      ok: false,
      error: { code: "NOT_FOUND", message: "no such run" },
    }));
    try {
      const [status] = buildRunForwardTools({ supervisorSocketPath: socketPath });
      const result = await status?.handler({ runId: "unknown" });
      expect(result?.isError).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it("run.cancel forwards and surfaces a successful result", async () => {
    const server = await startFakePeer(socketPath, () => ({
      ok: true,
      result: { accepted: true, runState: "cancelled" },
    }));
    try {
      const [, cancel] = buildRunForwardTools({ supervisorSocketPath: socketPath });
      const result = await cancel?.handler({ runId: "run-1", reason: "user requested" });
      expect(result?.isError).toBeUndefined();
      expect(JSON.parse(result?.content[0]?.text ?? "{}")).toEqual({
        accepted: true,
        runState: "cancelled",
      });
    } finally {
      await closeServer(server);
    }
  });

  it("run.cancel surfaces isError:true for a failed forward", async () => {
    const server = await startFakePeer(socketPath, () => ({
      ok: false,
      error: { code: "INTERNAL", message: "boom" },
    }));
    try {
      const [, cancel] = buildRunForwardTools({ supervisorSocketPath: socketPath });
      const result = await cancel?.handler({ runId: "run-1" });
      expect(result?.isError).toBe(true);
    } finally {
      await closeServer(server);
    }
  });
});
