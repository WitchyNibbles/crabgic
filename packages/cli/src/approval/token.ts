/**
 * Approval-token minting primitive — roadmap/09-cli-and-doctor.md §In
 * scope, "Approval UX foundation": "terminal prompt rendering an arbitrary
 * digest and minting a one-time HMAC token bound to it, journaled as
 * `approval_token_mint` (`JournalEntryType`, 02) — the human-only gate; no
 * model-driven call can mint one. Reused for two distinct subjects: 11's
 * envelope hash and 12's capability digest." §Risks: "This phase's own
 * minting primitive must carry an explicit subject-kind discriminator in
 * the entry payload so a capability-digest token can never verify against
 * an envelope-hash check or vice versa."
 *
 * The journal's own `approval_token_mint` payload schema
 * (`@eo/journal`/`@eo/contracts`) is `{ tokenId, scope }` — this module
 * folds `subjectKind`+`digest` into that `scope` string (`"<subjectKind>:<digest>"`)
 * since 04 doesn't carry a richer shape for this member; this primitive is
 * the sole place that convention is defined and parsed back.
 *
 * THIRD SUBJECT KIND (roadmap/22-learning-system.md, 2026-07-24): `learn
 * approve`'s independent-review step reuses this EXACT mechanism — never a
 * second, parallel HMAC implementation — for a THIRD, distinct subject
 * kind, `"learning_review"`. Additive only: `envelope_hash` (11) and
 * `capability_digest` (12) are completely unchanged; a `learning_review`
 * token can never verify against either of the other two subject kinds
 * (the existing `subjectKind` cross-check in `verify`/
 * `verifyApprovalTokenDurable` already enforces this, unmodified). See
 * `../learning/learn-command-backend.ts` for the caller that mints/
 * verifies against this subject kind — `@eo/learning` itself never holds
 * the signing secret or verifies a signature (see that package's own
 * `VerifiedApprovalRecord` doc comment for why).
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { JournalStore } from "@eo/journal";

export type ApprovalTokenSubjectKind = "envelope_hash" | "capability_digest" | "learning_review";

export interface MintedApprovalToken {
  readonly tokenId: string;
  readonly token: string;
  readonly subjectKind: ApprovalTokenSubjectKind;
  readonly digest: string;
  readonly mintedAt: string;
  readonly expiresAt: string;
}

export class ApprovalTokenExpiredError extends Error {
  constructor() {
    super("approval token has expired");
    this.name = "ApprovalTokenExpiredError";
  }
}

export class ApprovalTokenAlreadyVerifiedError extends Error {
  constructor() {
    super("approval token was already verified (single-use) — replay rejected");
    this.name = "ApprovalTokenAlreadyVerifiedError";
  }
}

export class ApprovalTokenMismatchError extends Error {
  constructor(detail: string) {
    super(`approval token does not bind to the expected subject: ${detail}`);
    this.name = "ApprovalTokenMismatchError";
  }
}

export class ApprovalTokenSignatureError extends Error {
  constructor() {
    super("approval token signature is invalid or the token is malformed");
    this.name = "ApprovalTokenSignatureError";
  }
}

/**
 * Exported (2026-07-24, roadmap/11-intake-contract-approval.md carry-forward
 * fix) so a cross-process, durable consumption ledger
 * (`./durable-approval-ledger.ts`) can verify a token's signature/expiry/
 * subject-binding WITHOUT depending on this class's own in-memory
 * `#pendingById` map — the in-memory `verify()` below only works when
 * called against the SAME `ApprovalTokenMinter` instance that minted the
 * token, which breaks across a real process boundary (the `run` CLI
 * invocation that mints vs. the separately-spawned `gateway mcp` stdio
 * process that later calls `contract.approve`). Purely additive: no
 * existing behavior of this module changes.
 */
export interface TokenPayload {
  readonly tokenId: string;
  readonly subjectKind: ApprovalTokenSubjectKind;
  readonly digest: string;
  readonly mintedAt: number;
  readonly expiresAt: number;
}

interface PendingMint {
  readonly payload: TokenPayload;
  readonly token: string;
  consumed: boolean;
}

export interface ApprovalTokenMinterOptions {
  /** HMAC signing key. Callers should supply a per-process-random key (never a hardcoded secret) unless deterministic tests require a fixed one. */
  readonly secretKey: Buffer;
  readonly clock?: () => number;
  readonly ttlMs?: number;
  /** When supplied, every mint journals one `approval_token_mint` entry (roadmap/09's own journaling requirement). Optional so this primitive's own unit/property tests can exercise it without a real journal. */
  readonly journal?: Pick<JournalStore, "appendEntry">;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function signPayload(secretKey: Buffer, payload: TokenPayload): string {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", secretKey).update(body).digest("hex");
  return Buffer.from(`${body}.${signature}`, "utf8").toString("base64url");
}

/** Exported alongside `TokenPayload` (see that type's own doc comment) — pure signature/shape verification only; carries no single-use state of its own. */
export function verifySignature(secretKey: Buffer, token: string): TokenPayload {
  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    throw new ApprovalTokenSignatureError();
  }
  const separatorIndex = decoded.lastIndexOf(".");
  if (separatorIndex === -1) throw new ApprovalTokenSignatureError();
  const body = decoded.slice(0, separatorIndex);
  const signature = decoded.slice(separatorIndex + 1);
  const expected = createHmac("sha256", secretKey).update(body).digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new ApprovalTokenSignatureError();
  }
  try {
    return JSON.parse(body) as TokenPayload;
  } catch {
    throw new ApprovalTokenSignatureError();
  }
}

export interface ApprovalTokenVerifyExpectation {
  readonly subjectKind: ApprovalTokenSubjectKind;
  readonly digest: string;
}

/**
 * Mints and verifies single-use, digest-bound, subject-discriminated
 * approval tokens. Reused verbatim for both 11's envelope-hash subject and
 * 12's capability-digest subject (roadmap/09 §Risks) — the subject kind is
 * part of the signed payload, so a token minted for one subject kind can
 * never verify against an expectation naming the other.
 */
export class ApprovalTokenMinter {
  readonly #secretKey: Buffer;
  readonly #clock: () => number;
  readonly #ttlMs: number;
  readonly #journal: Pick<JournalStore, "appendEntry"> | undefined;
  readonly #pendingByKey = new Map<string, PendingMint>();
  readonly #pendingById = new Map<string, PendingMint>();

  constructor(options: ApprovalTokenMinterOptions) {
    this.#secretKey = options.secretKey;
    this.#clock = options.clock ?? (() => Date.now());
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#journal = options.journal;
  }

  /**
   * Mints a token bound to `(subjectKind, digest)`. Minting twice against
   * the same, still-pending (not-yet-verified, not-yet-expired) subject
   * returns the SAME token without journaling a second time (work item 6's
   * failing-first framing) — a fresh mint only occurs once the prior one
   * has been consumed (verified) or has expired.
   */
  async mint(subjectKind: ApprovalTokenSubjectKind, digest: string): Promise<MintedApprovalToken> {
    const key = `${subjectKind}:${digest}`;
    const now = this.#clock();

    const existing = this.#pendingByKey.get(key);
    if (existing !== undefined && !existing.consumed && existing.payload.expiresAt > now) {
      return this.#toMinted(existing.payload, existing.token);
    }

    const payload: TokenPayload = {
      tokenId: randomUUID(),
      subjectKind,
      digest,
      mintedAt: now,
      expiresAt: now + this.#ttlMs,
    };
    const token = signPayload(this.#secretKey, payload);
    const pending: PendingMint = { payload, token, consumed: false };
    this.#pendingByKey.set(key, pending);
    this.#pendingById.set(payload.tokenId, pending);

    if (this.#journal !== undefined) {
      await this.#journal.appendEntry({
        type: "approval_token_mint",
        payload: { tokenId: payload.tokenId, scope: key },
      });
    }

    return this.#toMinted(payload, token);
  }

  /**
   * Verifies `token` against `expected`. Fails closed for every distinct
   * failure mode: bad/tampered signature (`ApprovalTokenSignatureError`),
   * wrong subject kind or digest (`ApprovalTokenMismatchError`), expired
   * (`ApprovalTokenExpiredError`), or already-verified/unknown-to-this-
   * minter (`ApprovalTokenAlreadyVerifiedError`) — a replay of an
   * already-verified token always lands in this last branch. On success,
   * marks the token consumed (single-use) and returns nothing.
   */
  verify(token: string, expected: ApprovalTokenVerifyExpectation): void {
    const payload = verifySignature(this.#secretKey, token);

    if (payload.subjectKind !== expected.subjectKind) {
      throw new ApprovalTokenMismatchError(
        `subject kind "${payload.subjectKind}" !== expected "${expected.subjectKind}"`,
      );
    }
    if (payload.digest !== expected.digest) {
      throw new ApprovalTokenMismatchError("digest does not match the expected value");
    }

    const pending = this.#pendingById.get(payload.tokenId);
    if (pending === undefined || pending.consumed) {
      throw new ApprovalTokenAlreadyVerifiedError();
    }
    if (payload.expiresAt <= this.#clock()) {
      throw new ApprovalTokenExpiredError();
    }

    pending.consumed = true;
  }

  #toMinted(payload: TokenPayload, token: string): MintedApprovalToken {
    return {
      tokenId: payload.tokenId,
      token,
      subjectKind: payload.subjectKind,
      digest: payload.digest,
      mintedAt: new Date(payload.mintedAt).toISOString(),
      expiresAt: new Date(payload.expiresAt).toISOString(),
    };
  }
}
