import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, createConnection, type Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PeerCredentialUnavailableError, readPeerCredentialsLinux } from "./peer-credentials.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-supervisor-peercred-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Real UDS socket in a tmp dir, no mocked transport — per roadmap/05's Integration test-plan bullet. */
function listenOnTempSocket(
  onConnection: (socket: Socket) => void,
): Promise<{ path: string; close: () => Promise<void> }> {
  const socketPath = join(root, "peercred-test.sock");
  return new Promise((resolve, reject) => {
    const server = createServer(onConnection);
    server.once("error", reject);
    server.listen(socketPath, () => {
      resolve({
        path: socketPath,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

describe("readPeerCredentialsLinux (real SO_PEERCRED, real UDS socket)", () => {
  it("reads back this process's own uid when connecting to itself", async () => {
    let resolveServerSocket!: (socket: Socket) => void;
    const serverSocketPromise = new Promise<Socket>((res) => {
      resolveServerSocket = res;
    });

    const { path, close } = await listenOnTempSocket((socket) => {
      resolveServerSocket(socket);
    });

    const client = createConnection(path);
    await new Promise<void>((resolve, reject) => {
      client.once("connect", () => resolve());
      client.once("error", reject);
    });

    const serverSocket = await serverSocketPromise;
    const credentials = await readPeerCredentialsLinux(serverSocket);

    expect(credentials.uid).toBe(process.getuid?.());
    expect(credentials.pid).toBe(process.pid); // client is this same test process

    client.end();
    await close();
  }, 15_000);

  it("fails closed (rejects PeerCredentialUnavailableError) for a socket-like object with no native fd", async () => {
    const fakeSocket = {} as unknown as Socket;
    await expect(readPeerCredentialsLinux(fakeSocket)).rejects.toBeInstanceOf(
      PeerCredentialUnavailableError,
    );
  });
});
