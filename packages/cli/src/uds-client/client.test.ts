/**
 * roadmap/09-cli-and-doctor.md §Test plan, Integration: "failing-first
 * command-level integration against a real supervisor (05) in tmp dirs."
 * This suite exercises the typed client itself directly against a real,
 * unmodified `@eo/supervisor` server (no mocked transport) — every command
 * handler in `../commands/*` reuses this exact client.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import {
  buildSupervisorRouter,
  createArtifactIndexRegistry,
  createChangeSetsRegistry,
  createRunsRegistry,
  createWorkUnitsRegistry,
  createWorkersRegistry,
  readPeerCredentialsLinux,
  startSupervisorServer,
  type SupervisorDependencies,
  type SupervisorServer,
} from "@eo/supervisor";
import { SupervisorUnavailableError } from "../errors.js";
import { connectUdsClient, UdsOperationError, type UdsClient } from "./client.js";

let root: string;
let server: SupervisorServer | undefined;
let client: UdsClient | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-cli-uds-"));
});

afterEach(async () => {
  await client?.close();
  client = undefined;
  await server?.close();
  server = undefined;
  await rm(root, { recursive: true, force: true });
});

function buildDeps(): SupervisorDependencies {
  return {
    journal: createJournalStore({ journalDir: join(root, "journal") }) as JournalStore,
    runs: createRunsRegistry(),
    changeSets: createChangeSetsRegistry(),
    workUnits: createWorkUnitsRegistry(),
    workers: createWorkersRegistry(),
    artifactIndex: createArtifactIndexRegistry(),
    liveWorkers: new Map(),
  };
}

async function startServer(deps = buildDeps()): Promise<{ server: SupervisorServer; deps: SupervisorDependencies }> {
  const runtimeDir = join(root, "run");
  const socketPath = join(runtimeDir, "control.sock");
  const router = buildSupervisorRouter(deps);
  const started = await startSupervisorServer({
    runtimeDir,
    socketPath,
    router,
    peerAuth: { reader: readPeerCredentialsLinux },
  });
  server = started;
  return { server: started, deps };
}

describe("connectUdsClient", () => {
  it("handshakes and round-trips a request/response against a real supervisor", async () => {
    const { server: started } = await startServer();
    client = await connectUdsClient({ socketPath: started.socketPath });

    const result = await client.request<{ changeSets: readonly unknown[] }>(
      "registry.changeSets.list",
      {},
    );
    expect(result.changeSets).toEqual([]);
  });

  it("pipelines concurrent requests correctly correlated by id", async () => {
    const { server: started } = await startServer();
    client = await connectUdsClient({ socketPath: started.socketPath });

    const [a, b, c] = await Promise.all([
      client.request("run.status", { runId: "11111111-1111-4111-8111-111111111111" }),
      client.request("registry.changeSets.list", {}),
      client.request("registry.workUnits.list", {}),
    ]);
    expect(a).toEqual({});
    expect(b).toEqual({ changeSets: [] });
    expect(c).toEqual({ workUnits: [] });
  });

  it("throws UdsOperationError for a well-formed ok:false response", async () => {
    const { server: started } = await startServer();
    client = await connectUdsClient({ socketPath: started.socketPath });

    await expect(client.request("bogus.op", {})).rejects.toThrow(UdsOperationError);
  });

  it("throws SupervisorUnavailableError when the socket doesn't exist", async () => {
    await expect(
      connectUdsClient({ socketPath: join(root, "no-such.sock"), connectTimeoutMs: 500 }),
    ).rejects.toThrow(SupervisorUnavailableError);
  });
});

describe("connectUdsClient — per-request timeout (adversarial-review fix, 2026-07-24)", () => {
  let rawServer: Server | undefined;

  afterEach(async () => {
    // Close the client FIRST — `net.Server#close()` waits for every
    // existing connection to end before its callback fires, so closing the
    // server first (while the client socket is still open) would hang.
    await client?.close();
    client = undefined;
    await new Promise<void>((resolve) => (rawServer ? rawServer.close(() => resolve()) : resolve()));
    rawServer = undefined;
  });

  it("rejects with SupervisorUnavailableError if the server accepts + handshakes but never answers a request", async () => {
    const socketPath = join(root, "hangs.sock");
    rawServer = createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) return;
        // Ack the handshake for real; silently swallow every request line
        // after that — this server never answers.
        socket.write(`${JSON.stringify({ type: "handshake_ack", protocolVersion: 1, accepted: true })}\n`);
      });
    });
    await new Promise<void>((resolve, reject) => {
      rawServer!.once("error", reject);
      rawServer!.listen(socketPath, () => resolve());
    });

    client = await connectUdsClient({ socketPath, requestTimeoutMs: 100 });
    await expect(client.request("run.status", { runId: "x" })).rejects.toThrow(
      SupervisorUnavailableError,
    );
    await expect(client.request("run.status", { runId: "x" })).rejects.toThrow(/timed out/);
  });
});
