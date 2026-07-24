/**
 * Test-support-only (not part of this package's public barrel) — a
 * MINIMAL BUT FAITHFUL stand-in for the real supervisor-issued
 * approval-token mechanism (`packages/cli/src/approval/*`), reproducing
 * every security property `../proposal-store/registry.ts`'s promotion
 * guard actually depends on: HMAC-signed payload, subject-kind
 * discrimination, explicit binding to ONE proposal's identity, expiry,
 * and single-use consumption.
 *
 * This is deliberately NOT the real mechanism, and this package never
 * imports `@eo/cli` (see `LearningReviewTokenVerifier`'s own doc comment
 * in `../proposal-store/registry.ts` for why: the dependency direction is
 * `@eo/cli` -> `@eo/learning`, never the reverse). It exists so this
 * package's OWN tests (`../proposal-store/registry.test.ts`,
 * `../red-team/self-promotion.redteam.test.ts`,
 * `../red-team/no-bypass.redteam.test.ts`, `../pipeline.e2e.test.ts`) can
 * exercise REAL verification semantics — forged, wrong-subject,
 * wrong-proposal-bound, and replayed tokens genuinely rejected — instead
 * of trusting a caller-supplied claim by name (the exact gap an
 * adversarial validator found and this module's introduction closes).
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { LearningProposal } from "@eo/contracts";
import type { LearningReviewTokenVerifier } from "../proposal-store/registry.js";

export const LEARNING_REVIEW_SUBJECT_KIND = "learning_review";

export interface ReferenceTokenPayload {
  readonly tokenId: string;
  readonly subjectKind: string;
  readonly proposalId: string;
  readonly expiresAt: number;
}

export class ReferenceTokenError extends Error {
  constructor(reason: string) {
    super(`reference-token-verifier: ${reason}`);
    this.name = "ReferenceTokenError";
  }
}

function sign(secretKey: Buffer, payload: ReferenceTokenPayload): string {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", secretKey).update(body).digest("hex");
  return Buffer.from(`${body}.${signature}`, "utf8").toString("base64url");
}

/** Mints a genuine, correctly-signed reference token. Test callers can override `subjectKind`/`proposalId` to construct an ATTACK token (wrong subject, wrong proposal binding) that is still validly SIGNED — proving the guard rejects it for the RIGHT reason (subject/binding), not merely because the signature happens to be bad. */
export function mintReferenceToken(
  secretKey: Buffer,
  options: {
    readonly proposalId: string;
    readonly subjectKind?: string;
    readonly ttlMs?: number;
    readonly clock?: () => number;
  },
): string {
  const now = (options.clock ?? Date.now)();
  const payload: ReferenceTokenPayload = {
    tokenId: randomUUID(),
    subjectKind: options.subjectKind ?? LEARNING_REVIEW_SUBJECT_KIND,
    proposalId: options.proposalId,
    expiresAt: now + (options.ttlMs ?? 10 * 60 * 1000),
  };
  return sign(secretKey, payload);
}

/** A syntactically-plausible but NOT genuinely signed token — the "two fabricated strings" attack shape. */
export function fabricateToken(): string {
  return Buffer.from(
    `${JSON.stringify({ tokenId: randomUUID(), subjectKind: LEARNING_REVIEW_SUBJECT_KIND, proposalId: "not-a-real-signature", expiresAt: Date.now() + 60_000 })}.deadbeefnotarealsignature`,
    "utf8",
  ).toString("base64url");
}

function verifySignature(secretKey: Buffer, token: string): ReferenceTokenPayload {
  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    throw new ReferenceTokenError("malformed token");
  }
  const separatorIndex = decoded.lastIndexOf(".");
  if (separatorIndex === -1) throw new ReferenceTokenError("malformed token");
  const body = decoded.slice(0, separatorIndex);
  const signature = decoded.slice(separatorIndex + 1);
  const expected = createHmac("sha256", secretKey).update(body).digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new ReferenceTokenError("signature invalid — token was not genuinely minted");
  }
  try {
    return JSON.parse(body) as ReferenceTokenPayload;
  } catch {
    throw new ReferenceTokenError("malformed payload");
  }
}

/**
 * Builds a `LearningReviewTokenVerifier` bound to `secretKey`, with its
 * own single-use ledger (a `Set` of already-consumed tokenIds). Rejects,
 * with a distinct reason each time: a bad/forged signature; the wrong
 * subject kind; a token bound to a DIFFERENT proposal (the confused-deputy
 * check — mirroring 11's `contract.approve` C1 fix); an expired token; and
 * a replay of an already-consumed token.
 */
export function createReferenceTokenVerifier(
  secretKey: Buffer,
  clock: () => number = Date.now,
): LearningReviewTokenVerifier {
  const consumedTokenIds = new Set<string>();

  return async (rawToken: string, proposal: LearningProposal) => {
    const payload = verifySignature(secretKey, rawToken);

    if (payload.subjectKind !== LEARNING_REVIEW_SUBJECT_KIND) {
      throw new ReferenceTokenError(
        `wrong subject kind "${payload.subjectKind}" (expected "${LEARNING_REVIEW_SUBJECT_KIND}")`,
      );
    }
    if (payload.proposalId !== proposal.id) {
      throw new ReferenceTokenError(
        `token is bound to proposal "${payload.proposalId}", not "${proposal.id}" ` +
          "(confused-deputy guard)",
      );
    }
    if (payload.expiresAt <= clock()) {
      throw new ReferenceTokenError("token expired");
    }
    if (consumedTokenIds.has(payload.tokenId)) {
      throw new ReferenceTokenError("token already consumed (single-use, replay rejected)");
    }
    consumedTokenIds.add(payload.tokenId);

    return { tokenId: payload.tokenId };
  };
}
