import { describe, expect, it } from "vitest";
import { authenticatePeer } from "./peer-auth-middleware.js";
import type { PeerCredentialReader } from "./peer-credentials.js";
import type { Socket } from "node:net";

const FAKE_SOCKET = {} as unknown as Socket;
const INVOKING_UID = 1000;

function readerReturning(uid: number): PeerCredentialReader {
  return async () => ({ pid: 4242, uid, gid: 1000 });
}

function readerThrowing(message: string): PeerCredentialReader {
  return async () => {
    throw new Error(message);
  };
}

describe("authenticatePeer", () => {
  it("admits a connection whose peer uid matches the invoking uid", async () => {
    const result = await authenticatePeer(FAKE_SOCKET, {
      reader: readerReturning(INVOKING_UID),
      invokingUid: INVOKING_UID,
    });
    expect(result.admitted).toBe(true);
  });

  it("refuses a connection from a foreign uid, before any request is served", async () => {
    const result = await authenticatePeer(FAKE_SOCKET, {
      reader: readerReturning(9999),
      invokingUid: INVOKING_UID,
    });
    expect(result.admitted).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("fails closed (refuses) when the credential bridge throws", async () => {
    const result = await authenticatePeer(FAKE_SOCKET, {
      reader: readerThrowing("bridge crashed"),
      invokingUid: INVOKING_UID,
    });
    expect(result.admitted).toBe(false);
  });

  it("fails closed when the credential bridge hangs past its own timeout (rejects)", async () => {
    const hangingReader: PeerCredentialReader = () =>
      new Promise(() => {
        // never resolves — simulates a hung bridge; authenticatePeer must not hang forever.
      });
    const result = await Promise.race([
      authenticatePeer(FAKE_SOCKET, {
        reader: hangingReader,
        invokingUid: INVOKING_UID,
        timeoutMs: 50,
      }),
      new Promise((resolve) => setTimeout(() => resolve({ admitted: "TEST_TIMEOUT" }), 500)),
    ]);
    expect(result).not.toEqual({ admitted: "TEST_TIMEOUT" });
    expect((result as { admitted: boolean }).admitted).toBe(false);
  });
});
