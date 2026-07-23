/**
 * roadmap/09-cli-and-doctor.md §Test plan, Property: "approval-token
 * properties (single-use, expiry, digest-binding) hold under randomized
 * digest sequences, exercised here against the primitive in isolation
 * before 11/12 exercise it end-to-end against their own subjects."
 */
import { randomBytes } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ApprovalTokenMinter, type ApprovalTokenSubjectKind } from "./token.js";

const subjectKindArb: fc.Arbitrary<ApprovalTokenSubjectKind> = fc.constantFrom(
  "envelope_hash",
  "capability_digest",
);
const digestArb = fc.stringMatching(/^[a-f0-9]{8,64}$/);

describe("ApprovalTokenMinter property suite", () => {
  it("single-use: a token verified once never verifies again, for any randomized (subjectKind, digest)", async () => {
    await fc.assert(
      fc.asyncProperty(subjectKindArb, digestArb, async (subjectKind, digest) => {
        const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
        const minted = await minter.mint(subjectKind, digest);
        minter.verify(minted.token, { subjectKind, digest });
        let secondFailed = false;
        try {
          minter.verify(minted.token, { subjectKind, digest });
        } catch {
          secondFailed = true;
        }
        expect(secondFailed).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("digest-binding: a token only ever verifies against the exact (subjectKind, digest) it was minted for", async () => {
    await fc.assert(
      fc.asyncProperty(
        subjectKindArb,
        digestArb,
        subjectKindArb,
        digestArb,
        async (mintedKind, mintedDigest, checkKind, checkDigest) => {
          fc.pre(mintedKind !== checkKind || mintedDigest !== checkDigest);
          const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
          const minted = await minter.mint(mintedKind, mintedDigest);
          let failed = false;
          try {
            minter.verify(minted.token, { subjectKind: checkKind, digest: checkDigest });
          } catch {
            failed = true;
          }
          expect(failed).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("expiry: a token never verifies once the clock has passed its expiresAt, for any randomized ttl/digest", async () => {
    await fc.assert(
      fc.asyncProperty(
        subjectKindArb,
        digestArb,
        fc.integer({ min: 1, max: 100_000 }),
        async (subjectKind, digest, ttlMs) => {
          let now = 0;
          const minter = new ApprovalTokenMinter({
            secretKey: randomBytes(32),
            ttlMs,
            clock: () => now,
          });
          const minted = await minter.mint(subjectKind, digest);
          now = ttlMs + 1;
          let failed = false;
          try {
            minter.verify(minted.token, { subjectKind, digest });
          } catch {
            failed = true;
          }
          expect(failed).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
