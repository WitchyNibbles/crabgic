/**
 * `SO_PEERCRED` peer-auth middleware — roadmap/05-supervisor-daemon.md work
 * item 2: "`SO_PEERCRED` peer-auth middleware admitting ONLY the invoking
 * uid's own processes." Fails closed on every failure mode: a foreign uid,
 * a credential-bridge throw, or a credential-bridge timeout are all
 * refused identically — none of them ever admits a connection. The
 * `reader` is always injected (`../peer-auth/peer-credentials.ts`'s real
 * `readPeerCredentialsLinux`, or a test double) so this module's own
 * tests never spawn a real subprocess — "simulate by injecting the peer
 * uid" (roadmap/05 work item 2's own RED framing).
 */

import type { Socket } from "node:net";
import type { PeerCredentialReader, PeerCredentials } from "./peer-credentials.js";

export interface PeerAuthResult {
  readonly admitted: boolean;
  readonly reason?: string;
  readonly credentials?: PeerCredentials;
}

export interface PeerAuthOptions {
  readonly reader: PeerCredentialReader;
  /** The uid this server's own process runs as — defaults to `process.getuid()`. Overridable for tests. */
  readonly invokingUid?: number;
  /** Safety bound on the credential read itself, in case `reader` never settles. Default 3000ms. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3_000;

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readWithTimeout(
  reader: PeerCredentialReader,
  socket: Socket,
  timeoutMs: number,
): Promise<PeerCredentials> {
  return new Promise<PeerCredentials>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`peer credential read timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    reader(socket).then(
      (credentials) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(credentials);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(toErrorMessage(err)));
      },
    );
  });
}

/**
 * The trust boundary itself: admits ONLY a connection whose real,
 * kernel-verified peer uid equals this server's own invoking uid — every
 * other outcome (foreign uid, unreadable credentials, a timed-out bridge)
 * is refused. Never throws: every failure mode resolves to
 * `{ admitted: false, reason }`, never a rejected promise, so callers
 * cannot accidentally treat an exception as "fail open."
 */
export async function authenticatePeer(
  socket: Socket,
  options: PeerAuthOptions,
): Promise<PeerAuthResult> {
  const invokingUid = options.invokingUid ?? process.getuid?.();
  if (invokingUid === undefined) {
    return { admitted: false, reason: "cannot determine invoking uid on this platform" };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let credentials: PeerCredentials;
  try {
    credentials = await readWithTimeout(options.reader, socket, timeoutMs);
  } catch (err) {
    // Fail closed: a crashed, throwing, or hung credential bridge is
    // indistinguishable from an attacker at this boundary — never admit.
    return { admitted: false, reason: `peer credential bridge failed: ${toErrorMessage(err)}` };
  }

  if (credentials.uid !== invokingUid) {
    return {
      admitted: false,
      reason: `foreign uid ${credentials.uid} refused (expected invoking uid ${invokingUid})`,
      credentials,
    };
  }

  return { admitted: true, credentials };
}
