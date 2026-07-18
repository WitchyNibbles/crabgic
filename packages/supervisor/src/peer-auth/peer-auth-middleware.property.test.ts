/**
 * Property test — roadmap/05-supervisor-daemon.md §Test plan, Property
 * (fast-check): "randomized peer-uid sequences — only the invoking uid's
 * own processes are ever admitted, foreign uids refused regardless of
 * arrival order." ≥1000 runs.
 */
import { describe, it } from "vitest";
import fc from "fast-check";
import { authenticatePeer } from "./peer-auth-middleware.js";
import type { PeerCredentialReader } from "./peer-credentials.js";
import type { Socket } from "node:net";

const FAKE_SOCKET = {} as unknown as Socket;
const INVOKING_UID = 1000;

function readerReturning(uid: number): PeerCredentialReader {
  return async () => ({ pid: 1, uid, gid: uid });
}

describe("authenticatePeer — property: only the invoking uid is ever admitted", () => {
  it("admits iff the peer uid equals the invoking uid, for any randomized uid sequence", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 65_535 }), { minLength: 1, maxLength: 50 }),
        async (uids) => {
          for (const uid of uids) {
            const result = await authenticatePeer(FAKE_SOCKET, {
              reader: readerReturning(uid),
              invokingUid: INVOKING_UID,
            });
            if (uid === INVOKING_UID) {
              if (result.admitted !== true) return false;
            } else {
              if (result.admitted !== false) return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("never admits a foreign uid regardless of how many invoking-uid connections preceded it", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constant(INVOKING_UID), { minLength: 0, maxLength: 20 }),
        fc.integer({ min: 0, max: 65_535 }).filter((uid) => uid !== INVOKING_UID),
        async (precedingSameUid, foreignUid) => {
          for (const uid of precedingSameUid) {
            const admitted = await authenticatePeer(FAKE_SOCKET, {
              reader: readerReturning(uid),
              invokingUid: INVOKING_UID,
            });
            if (!admitted.admitted) return false;
          }
          const foreign = await authenticatePeer(FAKE_SOCKET, {
            reader: readerReturning(foreignUid),
            invokingUid: INVOKING_UID,
          });
          return foreign.admitted === false;
        },
      ),
      { numRuns: 1000 },
    );
  });
});
