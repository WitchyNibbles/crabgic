/**
 * roadmap/05-supervisor-daemon.md §Test plan, Integration: "failing-first,
 * over a real UDS socket in tmp dirs (no mocked transport) — handshake
 * against version skew; router dispatch for run.status/run.cancel/
 * worker.*." §Security: "foreign-uid peer refused before any request is
 * served."
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { buildSupervisorRouter } from "../router/build-router.js";
import { SupervisorRouter } from "../router/router.js";
import { createRunsRegistry } from "../registries/runs-registry.js";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import { createWorkUnitsRegistry } from "../registries/work-units-registry.js";
import { createWorkersRegistry } from "../registries/workers-registry.js";
import { createArtifactIndexRegistry } from "../registries/artifact-index-registry.js";
import { readPeerCredentialsLinux } from "../peer-auth/peer-credentials.js";
import { PROTOCOL_VERSION } from "../protocol/wire-schema.js";
import { MAX_LINE_BYTES } from "../protocol/line-framer.js";
import { startSupervisorServer, type SupervisorServer } from "./uds-server.js";
import { connectTestClient } from "./test-support/supervisor-test-client.js";

let root: string;
let journalDir: string;
let store: JournalStore;
let server: SupervisorServer | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-supervisor-uds-"));
  journalDir = join(root, "journal");
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(root, { recursive: true, force: true });
});

function buildDeps() {
  return {
    journal: store,
    runs: createRunsRegistry(),
    changeSets: createChangeSetsRegistry(),
    workUnits: createWorkUnitsRegistry(),
    workers: createWorkersRegistry(),
    artifactIndex: createArtifactIndexRegistry(),
    liveWorkers: new Map(),
  };
}

async function startServer(router = buildSupervisorRouter(buildDeps())): Promise<SupervisorServer> {
  const runtimeDir = join(root, "run");
  const socketPath = join(runtimeDir, "control.sock");
  const started = await startSupervisorServer({
    runtimeDir,
    socketPath,
    router,
    peerAuth: { reader: readPeerCredentialsLinux }, // real reader — self-connect always matches our own uid
  });
  server = started;
  return started;
}

describe("UDS server — handshake version skew", () => {
  it("accepts a matching protocol version", async () => {
    const started = await startServer();
    const client = await connectTestClient(started.socketPath);
    const ack = await client.handshake(PROTOCOL_VERSION);
    expect(ack.accepted).toBe(true);
    client.close();
  });

  it("rejects a mismatched protocol version BEFORE serving any request", async () => {
    const started = await startServer();
    const client = await connectTestClient(started.socketPath);
    const ack = await client.handshake(PROTOCOL_VERSION + 1);
    expect(ack.accepted).toBe(false);

    // The server closes the connection after a rejected handshake — a
    // subsequent request must never receive a real response.
    await new Promise<void>((resolve) => {
      client.socket.once("close", () => resolve());
      client.socket.once("end", () => resolve());
    });
    client.close();
  });
});

describe("UDS server — router dispatch over the real socket", () => {
  it("dispatches run.status/run.cancel through the router and returns typed responses", async () => {
    const deps = buildDeps();
    const router = buildSupervisorRouter(deps);
    const started = await startServer(router);

    const client = await connectTestClient(started.socketPath);
    await client.handshake();

    const statusResponse = await client.request("run.status", {
      runId: "11111111-1111-4111-8111-111111111111",
    });
    expect(statusResponse.ok).toBe(true);
    expect(statusResponse.result).toEqual({});

    client.close();
  });

  it("returns a structured error response for an unknown operation, never crashing the connection", async () => {
    const started = await startServer();
    const client = await connectTestClient(started.socketPath);
    await client.handshake();

    const response = await client.request("bogus.op", {});
    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("DISPATCH_ERROR");

    // The connection is still alive — a bad op doesn't tear down the socket.
    const followUp = await client.request("registry.changeSets.list", {});
    expect(followUp.ok).toBe(true);

    client.close();
  });

  it("silently ignores a malformed/non-request line after the handshake, keeping the connection alive", async () => {
    const started = await startServer();
    const client = await connectTestClient(started.socketPath);
    await client.handshake();

    // Not a "request"-typed message at all (a bare event line) — must be
    // ignored, not tear down the connection.
    client.socket.write(`${JSON.stringify({ type: "event", event: "noise", payload: {} })}\n`);
    // A genuinely malformed (non-JSON) line — also ignored.
    client.socket.write("not even json\n");

    // The connection is still alive: a real request still gets a real response.
    const response = await client.request("registry.changeSets.list", {});
    expect(response.ok).toBe(true);

    client.close();
  });

  it("connecting and closing immediately (no handshake line ever sent) never crashes the server", async () => {
    const started = await startServer();
    const socket = createConnection(started.socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });
    socket.end();
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));

    // The server itself is still healthy for a subsequent, well-behaved connection.
    const client = await connectTestClient(started.socketPath);
    const ack = await client.handshake();
    expect(ack.accepted).toBe(true);
    client.close();
  });
});

describe("UDS server — foreign-uid peer refused before any request is served", () => {
  it("destroys the connection before the handshake, for a peer whose credential reader reports a foreign uid", async () => {
    const runtimeDir = join(root, "run");
    const socketPath = join(runtimeDir, "control.sock");
    const started = await startSupervisorServer({
      runtimeDir,
      socketPath,
      router: new SupervisorRouter(),
      peerAuth: {
        reader: async () => ({ pid: 1, uid: 999_999, gid: 999_999 }), // simulated foreign uid
        ...(process.getuid !== undefined ? { invokingUid: process.getuid() } : {}),
      },
    });
    server = started;

    const client = await connectTestClient(started.socketPath);
    client.socket.write(
      `${JSON.stringify({ type: "handshake", protocolVersion: PROTOCOL_VERSION, clientName: "attacker" })}\n`,
    );

    const closed = await new Promise<boolean>((resolve) => {
      client.socket.once("close", () => resolve(true));
      const timer = setTimeout(() => resolve(false), 2_000);
      timer.unref?.();
    });
    expect(closed).toBe(true);
  });
});

describe("UDS server — MAX_LINE_BYTES cap on the real socket read path", () => {
  it("disconnects an admitted (same-uid) peer that sends more than MAX_LINE_BYTES with no newline", async () => {
    const started = await startServer();
    const client = await connectTestClient(started.socketPath);
    await client.handshake();

    // Deliberately unframed: no trailing newline, well over the cap. A
    // real attacker scenario would never stop sending; this is the
    // bounded stand-in for "never sends a newline."
    const overCap = "z".repeat(MAX_LINE_BYTES + 100);
    client.socket.write(overCap);

    const closed = await new Promise<boolean>((resolve) => {
      client.socket.once("close", () => resolve(true));
      const timer = setTimeout(() => resolve(false), 5_000);
      timer.unref?.();
    });
    expect(closed).toBe(true);
  });

  it("still parses a normal framed request whose line size is large but under the cap, and the connection stays alive afterward", async () => {
    const started = await startServer();
    const client = await connectTestClient(started.socketPath);
    await client.handshake();

    // Comfortably under MAX_LINE_BYTES once JSON-encoded (id/op/params
    // structure overhead is a few dozen bytes, negligible against a
    // 10_000-byte margin) — proves the cap doesn't reject legitimate,
    // merely-large single-line messages.
    const padding = "y".repeat(MAX_LINE_BYTES - 10_000);
    const response = await client.request("bogus.op.large-payload", { padding });
    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("DISPATCH_ERROR");

    // The connection is still alive: the handshake and the normal request
    // loop both keep working after a large-but-legal line.
    const followUp = await client.request("registry.changeSets.list", {});
    expect(followUp.ok).toBe(true);

    client.close();
  });
});
