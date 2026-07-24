/**
 * Durable, cross-process approval-token verification — roadmap/11-intake-
 * contract-approval.md's own carry-forward instruction (09's own
 * `ApprovalTokenMinter.verify()` is documented, in that module's own file,
 * as correct only "under SEQUENTIAL calls... against the SAME minter
 * instance"; its single-use tracking (`#pendingById`) lives in ONE
 * process's memory). `contract.approve` is registered into the `gateway
 * mcp` stdio server's tool registry (`./tool-definitions.ts`) — that stdio
 * process is a SEPARATE OS process from whichever `run` CLI invocation
 * minted the token via `runApprovalFlow` (`packages/cli`'s own terminal-
 * prompt flow), so `ApprovalTokenMinter.verify()` called from inside the
 * `gateway mcp` process would see an EMPTY `#pendingById` map for every
 * legitimately-minted token and incorrectly report
 * `ApprovalTokenAlreadyVerifiedError` for every first, legitimate
 * verification attempt — the exact cross-process gap flagged for 11 to
 * close.
 *
 * FIX: this module verifies a token's signature/expiry/subject-binding via
 * `./token.js`'s now-exported, STATELESS `verifySignature` (a pure HMAC
 * check against the shared secret key — correct across any process that
 * holds the same key), and tracks single-use consumption via 04's
 * `IdempotencyRegistry` (`@eo/journal`) keyed by `(tokenId, subjectKind:
 * digest)` — durable on disk (the journal), so it is correct across BOTH a
 * process boundary and a restart, unlike the in-memory map it replaces for
 * this cross-process call path. `ApprovalTokenMinter.verify()` itself is
 * UNCHANGED and still correct for same-process callers (e.g. this
 * primitive's own unit tests, or a future same-process caller) — this
 * module is an ADDITIONAL, durable verification path, not a replacement.
 *
 * HIGH H2 repair (adversarial-validation finding): `IdempotencyRegistry.
 * checkOrRecord` is EXPLICITLY documented (`@eo/journal`'s own
 * `idempotency.ts`) as unsafe against two truly concurrent FIRST-time calls
 * for the same key — "both could observe 'no prior record' before either
 * persists... production callers with genuine concurrent first-writers
 * should serialize calls... themselves." This module previously added no
 * such serialization, so two overlapping verifications of the SAME token
 * (cross-process, or merely two interleaved async calls in one process)
 * could both record "recorded" and both return success — a real single-use
 * violation. FIX: the check-and-record critical section is now wrapped in
 * a real, durable, per-tokenId file lock — `@eo/journal`'s own `Lease`
 * primitive (roadmap/04 work item 6), keyed by `tokenId` (its
 * `projectHash` constructor parameter is just an opaque lock-file-name
 * identity — nothing requires it to literally be a project hash) rather
 * than 04's own project-wide convenience wrapper, so unrelated tokens never
 * contend with each other. `maxAcquireAttempts`/`retryDelayMs` make a
 * losing concurrent caller WAIT for the lease rather than fail on mere
 * contention; once it acquires the lease (after the winner has released
 * it, having already durably recorded consumption), it runs the identical
 * `checkOrRecord` call and observes "replayed" — correctly rejecting via
 * the SAME `ApprovalTokenAlreadyVerifiedError` branch, never a distinct
 * lock-specific error. `autoRenew: false` + a short `ttlMs`: this lock is
 * held only for the duration of one `checkOrRecord` call, never a
 * long-lived resource needing heartbeat renewal.
 */
import { dirname, join } from "node:path";
import { IdempotencyRegistry, Lease, type JournalStore } from "@eo/journal";
import {
  ApprovalTokenAlreadyVerifiedError,
  ApprovalTokenExpiredError,
  ApprovalTokenMismatchError,
  verifySignature,
  type ApprovalTokenSubjectKind,
  type ApprovalTokenVerifyExpectation,
} from "./token.js";

export interface DurableApprovalLedgerOptions {
  readonly secretKey: Buffer;
  readonly journal: JournalStore;
  readonly clock?: () => number;
  /**
   * Directory the per-tokenId lease lock files live under. Defaults to an
   * `approval-leases/` directory sibling to the journal's own segments
   * directory — colocated with the same durability domain the journal
   * itself uses, so a test's own isolated `journalDir` gets an isolated
   * lock directory for free with no extra wiring.
   */
  readonly leaseDir?: string;
  /** How many times a losing concurrent caller re-attempts acquiring the per-tokenId lease before giving up. Default 20 (with a small retry delay) — generous enough that a legitimate loser always eventually observes the winner's recorded consumption rather than spuriously failing on lock contention alone. */
  readonly maxLeaseAcquireAttempts?: number;
  readonly leaseRetryDelayMs?: number;
}

const DEFAULT_MAX_LEASE_ACQUIRE_ATTEMPTS = 20;
const DEFAULT_LEASE_RETRY_DELAY_MS = 10;
const LEASE_TTL_MS = 5_000;

/**
 * Verifies `token` against `expected` durably: signature + expiry +
 * subject/digest binding (via `verifySignature`, stateless), then a
 * single-use claim via `IdempotencyRegistry.checkOrRecord`. Fails closed
 * for every distinct failure mode, mirroring `ApprovalTokenMinter.verify`'s
 * own exhaustive error taxonomy:
 *  - bad/tampered/malformed token -> `ApprovalTokenSignatureError`
 *  - wrong subject kind or digest -> `ApprovalTokenMismatchError`
 *  - expired -> `ApprovalTokenExpiredError`
 *  - already consumed (replay, from ANY process, ever) -> `ApprovalTokenAlreadyVerifiedError`
 *
 * On success, the claim is durably recorded — a second call with the same
 * `token`, from any process, at any later time, always lands in the
 * `ApprovalTokenAlreadyVerifiedError` branch (single-use, cross-process).
 */
export async function verifyApprovalTokenDurable(
  token: string,
  expected: ApprovalTokenVerifyExpectation,
  options: DurableApprovalLedgerOptions,
): Promise<void> {
  const payload = verifySignature(options.secretKey, token);

  if (payload.subjectKind !== expected.subjectKind) {
    throw new ApprovalTokenMismatchError(
      `subject kind "${payload.subjectKind}" !== expected "${expected.subjectKind}"`,
    );
  }
  if (payload.digest !== expected.digest) {
    throw new ApprovalTokenMismatchError("digest does not match the expected value");
  }

  const clock = options.clock ?? (() => Date.now());
  if (payload.expiresAt <= clock()) {
    throw new ApprovalTokenExpiredError();
  }

  // HIGH H2: the check-and-record critical section below is NOT safe
  // against two truly concurrent first-time callers on its own
  // (`IdempotencyRegistry`'s own documented limitation) — a real,
  // per-tokenId file lock serializes every verification attempt for this
  // exact token, cross-process, before either one ever calls
  // `checkOrRecord`.
  const leaseDir = options.leaseDir ?? defaultLeaseDir(options.journal);
  const lease = await Lease.acquire(leaseDir, payload.tokenId, {
    autoRenew: false,
    ttlMs: LEASE_TTL_MS,
    maxAcquireAttempts: options.maxLeaseAcquireAttempts ?? DEFAULT_MAX_LEASE_ACQUIRE_ATTEMPTS,
    retryDelayMs: options.leaseRetryDelayMs ?? DEFAULT_LEASE_RETRY_DELAY_MS,
  });
  try {
    const idempotency = new IdempotencyRegistry(options.journal);
    const contentKey = contentHashFor(payload.subjectKind, payload.digest);
    const outcome = await idempotency.checkOrRecord<{ readonly consumedAt: number }>(
      payload.tokenId,
      contentKey,
      () => ({ consumedAt: clock() }),
    );

    if (outcome.status !== "recorded") {
      // "replayed" (already consumed — by this call's own prior attempt,
      // by another process, or by whichever concurrent caller won the
      // lease race above and already recorded consumption before this
      // caller acquired it) or "conflict" (should be unreachable given the
      // signature/digest check above already pins `contentKey` to this
      // exact tokenId's own payload — kept as a fail-closed branch rather
      // than an unreachable assertion, matching this repo's own "never
      // silently trust an invariant" convention).
      throw new ApprovalTokenAlreadyVerifiedError();
    }
  } finally {
    await lease.release();
  }
}

/** `<journalDir>/approval-leases/` — a sibling of the journal's own `segments/`/`snapshots/` directories, so this lock lives in the same durability domain as the journal it protects. */
function defaultLeaseDir(journal: JournalStore): string {
  return join(dirname(journal.config.segmentsDir), "approval-leases");
}

function contentHashFor(subjectKind: ApprovalTokenSubjectKind, digest: string): string {
  return `${subjectKind}:${digest}`;
}
