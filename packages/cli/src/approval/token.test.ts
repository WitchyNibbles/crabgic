import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ApprovalTokenAlreadyVerifiedError,
  ApprovalTokenExpiredError,
  ApprovalTokenMinter,
  ApprovalTokenMismatchError,
  ApprovalTokenSignatureError,
} from "./token.js";

function makeMinter(overrides: Partial<ConstructorParameters<typeof ApprovalTokenMinter>[0]> = {}) {
  return new ApprovalTokenMinter({ secretKey: randomBytes(32), ...overrides });
}

describe("ApprovalTokenMinter", () => {
  it("mints a token and verifies it exactly once", async () => {
    const minter = makeMinter();
    const minted = await minter.mint("envelope_hash", "digest-1");
    expect(() => minter.verify(minted.token, { subjectKind: "envelope_hash", digest: "digest-1" })).not.toThrow();
  });

  it("verifying with the wrong digest fails closed", async () => {
    const minter = makeMinter();
    const minted = await minter.mint("envelope_hash", "digest-1");
    expect(() =>
      minter.verify(minted.token, { subjectKind: "envelope_hash", digest: "digest-WRONG" }),
    ).toThrow(ApprovalTokenMismatchError);
  });

  it("verifying with the wrong subject kind fails closed even with the same digest", async () => {
    const minter = makeMinter();
    const minted = await minter.mint("envelope_hash", "shared-digest");
    expect(() =>
      minter.verify(minted.token, { subjectKind: "capability_digest", digest: "shared-digest" }),
    ).toThrow(ApprovalTokenMismatchError);
  });

  it("replay: verifying the same token twice fails closed on the second attempt", async () => {
    const minter = makeMinter();
    const minted = await minter.mint("capability_digest", "digest-2");
    minter.verify(minted.token, { subjectKind: "capability_digest", digest: "digest-2" });
    expect(() =>
      minter.verify(minted.token, { subjectKind: "capability_digest", digest: "digest-2" }),
    ).toThrow(ApprovalTokenAlreadyVerifiedError);
  });

  it("expires after the TTL", async () => {
    let now = 1_000_000;
    const minter = makeMinter({ ttlMs: 1_000, clock: () => now });
    const minted = await minter.mint("envelope_hash", "digest-3");
    now += 1_001;
    expect(() =>
      minter.verify(minted.token, { subjectKind: "envelope_hash", digest: "digest-3" }),
    ).toThrow(ApprovalTokenExpiredError);
  });

  it("a tampered token fails signature verification", async () => {
    const minter = makeMinter();
    const minted = await minter.mint("envelope_hash", "digest-4");
    const midpoint = Math.floor(minted.token.length / 2);
    const flippedChar = minted.token[midpoint] === "a" ? "b" : "a";
    const tampered =
      minted.token.slice(0, midpoint) + flippedChar + minted.token.slice(midpoint + 1);
    expect(() =>
      minter.verify(tampered, { subjectKind: "envelope_hash", digest: "digest-4" }),
    ).toThrow(ApprovalTokenSignatureError);
  });

  it("a token minted by one minter never verifies against a different minter's key", async () => {
    const a = makeMinter();
    const b = makeMinter();
    const minted = await a.mint("envelope_hash", "digest-5");
    expect(() =>
      b.verify(minted.token, { subjectKind: "envelope_hash", digest: "digest-5" }),
    ).toThrow(ApprovalTokenSignatureError);
  });

  it("minting twice against the same still-pending digest does not double-journal", async () => {
    const appended: unknown[] = [];
    const minter = makeMinter({
      journal: {
        appendEntry: async (input) => {
          appended.push(input);
          return input as never;
        },
      },
    });
    const first = await minter.mint("envelope_hash", "digest-6");
    const second = await minter.mint("envelope_hash", "digest-6");
    expect(second.tokenId).toBe(first.tokenId);
    expect(appended).toHaveLength(1);
  });

  it("re-minting after the prior token was consumed DOES journal again (new token)", async () => {
    const appended: unknown[] = [];
    const minter = makeMinter({
      journal: {
        appendEntry: async (input) => {
          appended.push(input);
          return input as never;
        },
      },
    });
    const first = await minter.mint("envelope_hash", "digest-7");
    minter.verify(first.token, { subjectKind: "envelope_hash", digest: "digest-7" });
    const second = await minter.mint("envelope_hash", "digest-7");
    expect(second.tokenId).not.toBe(first.tokenId);
    expect(appended).toHaveLength(2);
  });

  it("verifying an unknown token (never minted by this minter's in-memory state) fails closed", () => {
    const other = makeMinter();
    const unrelated = makeMinter();
    // Construct a signature-valid-looking but never-tracked token by minting
    // then discarding the minter instance's own bookkeeping is impossible
    // from outside; instead assert the cross-minter case above covers the
    // "unknown to this minter" branch, and this case covers a syntactically
    // invalid token.
    expect(() =>
      other.verify("not-a-real-token", { subjectKind: "envelope_hash", digest: "x" }),
    ).toThrow(ApprovalTokenSignatureError);
    expect(unrelated).toBeDefined();
  });
});
