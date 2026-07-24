import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import {
  ApprovalTokenAlreadyVerifiedError,
  ApprovalTokenExpiredError,
  ApprovalTokenMismatchError,
  ApprovalTokenMinter,
  ApprovalTokenSignatureError,
} from "./token.js";
import { verifyApprovalTokenDurable } from "./durable-approval-ledger.js";

let journalDir: string;
let store: JournalStore;
const secretKey = randomBytes(32);

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-cli-durable-ledger-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("verifyApprovalTokenDurable", () => {
  it("verifies a token minted by a DIFFERENT ApprovalTokenMinter instance (simulating a separate process)", async () => {
    // Process A: mints (e.g. the `run` CLI's terminal-prompt flow).
    const mintingProcessMinter = new ApprovalTokenMinter({ secretKey });
    const minted = await mintingProcessMinter.mint("envelope_hash", "sha256:abc");

    // Process B: a brand-new minter instance with an EMPTY in-memory pending
    // map — `ApprovalTokenMinter.verify()` itself would incorrectly throw
    // ApprovalTokenAlreadyVerifiedError here; the durable ledger must not.
    const verifyingProcessMinter = new ApprovalTokenMinter({ secretKey });
    expect(() =>
      verifyingProcessMinter.verify(minted.token, {
        subjectKind: "envelope_hash",
        digest: "sha256:abc",
      }),
    ).toThrow(ApprovalTokenAlreadyVerifiedError);

    await expect(
      verifyApprovalTokenDurable(
        minted.token,
        { subjectKind: "envelope_hash", digest: "sha256:abc" },
        { secretKey, journal: store },
      ),
    ).resolves.toBeUndefined();
  });

  it("fails closed on replay — even from a third, independent process/journal handle", async () => {
    const minter = new ApprovalTokenMinter({ secretKey });
    const minted = await minter.mint("envelope_hash", "sha256:abc");
    const expected = { subjectKind: "envelope_hash" as const, digest: "sha256:abc" };

    await verifyApprovalTokenDurable(minted.token, expected, { secretKey, journal: store });

    await expect(
      verifyApprovalTokenDurable(minted.token, expected, { secretKey, journal: store }),
    ).rejects.toThrow(ApprovalTokenAlreadyVerifiedError);
  });

  it("fails closed for a token with no pre-mint at all (model self-approval fixture)", async () => {
    await expect(
      verifyApprovalTokenDurable(
        "not-a-real-token",
        { subjectKind: "envelope_hash", digest: "sha256:abc" },
        { secretKey, journal: store },
      ),
    ).rejects.toThrow(ApprovalTokenSignatureError);
  });

  it("fails closed for a token minted for a DIFFERENT digest — the envelope-tamper / amendment fixture", async () => {
    const minter = new ApprovalTokenMinter({ secretKey });
    const minted = await minter.mint("envelope_hash", "sha256:original-envelope-hash");

    // Simulates: approve, amend (new envelope hash), then replay the OLD token.
    await expect(
      verifyApprovalTokenDurable(
        minted.token,
        { subjectKind: "envelope_hash", digest: "sha256:amended-envelope-hash" },
        { secretKey, journal: store },
      ),
    ).rejects.toThrow(ApprovalTokenMismatchError);
  });

  it("fails closed for a token minted under a different subjectKind (capability_digest vs envelope_hash cross-binding)", async () => {
    const minter = new ApprovalTokenMinter({ secretKey });
    const minted = await minter.mint("capability_digest", "sha256:abc");

    await expect(
      verifyApprovalTokenDurable(
        minted.token,
        { subjectKind: "envelope_hash", digest: "sha256:abc" },
        { secretKey, journal: store },
      ),
    ).rejects.toThrow(ApprovalTokenMismatchError);
  });

  it("fails closed for an expired token", async () => {
    let now = 1_000_000;
    const clock = () => now;
    const minter = new ApprovalTokenMinter({ secretKey, clock, ttlMs: 1000 });
    const minted = await minter.mint("envelope_hash", "sha256:abc");

    now += 5000; // past expiry
    await expect(
      verifyApprovalTokenDurable(
        minted.token,
        { subjectKind: "envelope_hash", digest: "sha256:abc" },
        { secretKey, journal: store, clock },
      ),
    ).rejects.toThrow(ApprovalTokenExpiredError);
  });

  it("HIGH H2: two overlapping (concurrent) verifications of the SAME token — exactly one succeeds, the other observes the recorded consumption", async () => {
    const minter = new ApprovalTokenMinter({ secretKey });
    const minted = await minter.mint("envelope_hash", "sha256:concurrent-abc");
    const expected = { subjectKind: "envelope_hash" as const, digest: "sha256:concurrent-abc" };

    // No `await` between the two calls — both start against a
    // fresh(-looking) journal state before either has recorded anything,
    // reproducing exactly the race `@eo/journal`'s own `IdempotencyRegistry`
    // documents as unsafe for two truly concurrent first-time calls.
    const results = await Promise.allSettled([
      verifyApprovalTokenDurable(minted.token, expected, { secretKey, journal: store }),
      verifyApprovalTokenDurable(minted.token, expected, { secretKey, journal: store }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ApprovalTokenAlreadyVerifiedError,
    );
  });

  it("HIGH H2: many (10) overlapping verifications of the SAME token — exactly one ever succeeds", async () => {
    const minter = new ApprovalTokenMinter({ secretKey });
    const minted = await minter.mint("envelope_hash", "sha256:concurrent-many");
    const expected = { subjectKind: "envelope_hash" as const, digest: "sha256:concurrent-many" };

    const attempts = Array.from({ length: 10 }, () =>
      verifyApprovalTokenDurable(minted.token, expected, { secretKey, journal: store }),
    );
    const results = await Promise.allSettled(attempts);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(9);
  });

  it("fails closed for a signature from a different secret key (a worker cannot forge one)", async () => {
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
    const minted = await minter.mint("envelope_hash", "sha256:abc");

    await expect(
      verifyApprovalTokenDurable(
        minted.token,
        { subjectKind: "envelope_hash", digest: "sha256:abc" },
        { secretKey: randomBytes(32), journal: store },
      ),
    ).rejects.toThrow(ApprovalTokenSignatureError);
  });
});
