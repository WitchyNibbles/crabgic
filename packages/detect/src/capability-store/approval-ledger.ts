/**
 * `createApprovalLedger` — a tiny on-disk `tokenId -> digest` record kept
 * alongside the capability store (`./layout.ts`'s same root, `approvals/`
 * subdirectory). `trust approve` (`../trust/trust-approve.ts`) records one
 * entry per mint; `trust revoke <token-id>` (`../trust/trust-revoke.ts`)
 * is the only consumer — a `TrustRevokeCommand` (09) carries just a
 * `tokenId`, never a digest, so this is the sole mechanism that lets
 * revoke find WHICH capability-store entry to flip back.
 *
 * Deliberately independent of `ApprovalTokenMinter`'s own internal
 * single-use bookkeeping (`engineering-orchestrator`) — that primitive
 * forgets a token once verified/expired (by design, per its own doc
 * comment), so it cannot answer "which digest did this tokenId belong
 * to?" after the fact. This ledger's own record persists regardless.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ApprovalLedger {
  record(tokenId: string, digest: string): void;
  lookup(tokenId: string): string | undefined;
}

export function createApprovalLedger(capabilityStoreRootDir: string): ApprovalLedger {
  const dir = join(capabilityStoreRootDir, "approvals");
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  return {
    record(tokenId, digest) {
      writeFileSync(join(dir, `${encodeURIComponent(tokenId)}.json`), JSON.stringify({ digest }), {
        mode: 0o600,
      });
    },
    lookup(tokenId) {
      const path = join(dir, `${encodeURIComponent(tokenId)}.json`);
      if (!existsSync(path)) return undefined;
      const { digest } = JSON.parse(readFileSync(path, "utf8")) as { digest: string };
      return digest;
    },
  };
}
