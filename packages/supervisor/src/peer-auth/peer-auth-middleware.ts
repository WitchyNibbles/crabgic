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
  /**
   * Additional uids this server admits besides its own — the enabling half of
   * WRITER-IDENTITY SEPARATION (`docs/threat-model.md`'s "same-uid trust
   * flattening" theme).
   *
   * Running the daemon as its own uid, owning the state root, is what stops a
   * worker from having any write path to the journal. But then the operator's
   * CLI is a foreign uid, and strict equality would lock it out — so the
   * separation needs a way to say "this other uid is also me."
   *
   * EXPLICIT BY CONSTRUCTION, and that is the point: omitted or empty behaves
   * exactly like before (own uid only), so this can never widen a deployment
   * that did not ask for it. Every admitted uid is one an operator wrote down.
   */
  readonly additionalAllowedUids?: readonly number[];
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

  const allowed = new Set<number>([invokingUid, ...(options.additionalAllowedUids ?? [])]);
  if (!allowed.has(credentials.uid)) {
    // The refusal names the WHOLE allow-set, not just the invoking uid: under
    // separation "expected uid X" is misleading when several are legitimate,
    // and an operator debugging a locked-out CLI needs to see what actually
    // was permitted.
    const permitted = [...allowed].sort((a, b) => a - b).join(", ");
    return {
      admitted: false,
      reason: `foreign uid ${credentials.uid} refused (permitted uids: ${permitted})`,
      credentials,
    };
  }

  return { admitted: true, credentials };
}
