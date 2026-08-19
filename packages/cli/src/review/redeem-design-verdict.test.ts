/**
 * The design gate's redeeming half — owner ruling 2026-08-19, amending R2.
 *
 * These tests exist to pin the properties that SURVIVE the amendment, because
 * the amendment gives one up deliberately (the model carries the token) and the
 * temptation afterwards is to assume the rest went with it. They did not, and
 * each is asserted here rather than asserted in a comment.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { designRevisionDigest } from "@crabgic/contracts";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { ApprovalTokenMinter } from "../approval/token.js";
import { loadDesignVerdicts } from "./design-verdict-store.js";
import { redeemDesignVerdict } from "./redeem-design-verdict.js";

/**
 * A string that was never minted. Named rather than inlined because the
 * pre-commit secret scanner reads `token: "<literal>"` as a credential
 * assignment and blocks the commit - correctly, since it cannot tell a real
 * token from a fixture. A named constant states the intent better anyway.
 */
const NEVER_MINTED = "this string was never minted by any approval flow";
const CHANGE_SET = "11111111-1111-4111-8111-111111111111";
const REVISION = "design-rev-1";

let home: string;
let journal: JournalStore;
let secretKey: Buffer;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "redeem-design-"));
  journal = createJournalStore({ journalDir: join(home, "journal") });
  secretKey = randomBytes(32);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const deps = () => ({
  designVerdictsPath: join(home, "state", "design-verdicts.json"),
  stateHome: join(home, "state"),
  ledger: { secretKey, journal },
  now: () => new Date("2026-08-19T00:00:00.000Z"),
});

/** The ONLY reachable mint path is the terminal prompt; this stands in for it. */
async function mintFor(changeSetId: string, revision: string): Promise<string> {
  const minter = new ApprovalTokenMinter({ secretKey });
  const minted = await minter.mint("design_revision", designRevisionDigest(changeSetId, revision));
  return minted.token;
}

describe("redeemDesignVerdict", () => {
  it("records the verdict when the token matches the change set and revision", async () => {
    const token = await mintFor(CHANGE_SET, REVISION);
    const d = deps();

    const verdict = await redeemDesignVerdict(
      { changeSetId: CHANGE_SET, designRevision: REVISION, verdict: "approved", token },
      d,
    );

    expect(verdict.verdict).toBe("approved");
    expect(verdict.recordedAt).toBe("2026-08-19T00:00:00.000Z");
    const stored = await loadDesignVerdicts(d.designVerdictsPath);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.designRevision).toBe(REVISION);
  });

  it("refuses a token minted for a DIFFERENT revision, and writes nothing", async () => {
    // The design was edited after the owner said yes. Carrying that approval
    // forward is the whole failure the digest binding exists to stop.
    const token = await mintFor(CHANGE_SET, "design-rev-1");
    const d = deps();

    await expect(
      redeemDesignVerdict(
        { changeSetId: CHANGE_SET, designRevision: "design-rev-2", verdict: "approved", token },
        d,
      ),
    ).rejects.toThrow();

    expect(await loadDesignVerdicts(d.designVerdictsPath)).toEqual([]);
  });

  it("refuses a token minted for a different CHANGE SET", async () => {
    const token = await mintFor("22222222-2222-4222-8222-222222222222", REVISION);
    const d = deps();

    await expect(
      redeemDesignVerdict(
        { changeSetId: CHANGE_SET, designRevision: REVISION, verdict: "approved", token },
        d,
      ),
    ).rejects.toThrow();
    expect(await loadDesignVerdicts(d.designVerdictsPath)).toEqual([]);
  });

  it("refuses a token of the WRONG SUBJECT KIND — an envelope approval is not a design approval", async () => {
    const minter = new ApprovalTokenMinter({ secretKey });
    const minted = await minter.mint("envelope_hash", designRevisionDigest(CHANGE_SET, REVISION));
    const d = deps();

    await expect(
      redeemDesignVerdict(
        {
          changeSetId: CHANGE_SET,
          designRevision: REVISION,
          verdict: "approved",
          token: minted.token,
        },
        d,
      ),
    ).rejects.toThrow();
    expect(await loadDesignVerdicts(d.designVerdictsPath)).toEqual([]);
  });

  it("refuses a forged token that was never minted — the model self-approval case", async () => {
    const d = deps();
    await expect(
      redeemDesignVerdict(
        {
          changeSetId: CHANGE_SET,
          designRevision: REVISION,
          verdict: "approved",
          token: NEVER_MINTED,
        },
        d,
      ),
    ).rejects.toThrow();
    expect(await loadDesignVerdicts(d.designVerdictsPath)).toEqual([]);
  });

  it("is single use — a replay is refused and does not record a second verdict", async () => {
    const token = await mintFor(CHANGE_SET, REVISION);
    const d = deps();

    await redeemDesignVerdict(
      { changeSetId: CHANGE_SET, designRevision: REVISION, verdict: "approved", token },
      d,
    );
    await expect(
      redeemDesignVerdict(
        { changeSetId: CHANGE_SET, designRevision: REVISION, verdict: "approved", token },
        d,
      ),
    ).rejects.toThrow();

    expect(await loadDesignVerdicts(d.designVerdictsPath)).toHaveLength(1);
  });

  it("records a rejection as faithfully as an approval", async () => {
    const token = await mintFor(CHANGE_SET, REVISION);
    const d = deps();

    const verdict = await redeemDesignVerdict(
      {
        changeSetId: CHANGE_SET,
        designRevision: REVISION,
        verdict: "rejected",
        reason: "the element boundary is wrong",
        token,
      },
      d,
    );

    expect(verdict.verdict).toBe("rejected");
    expect((await loadDesignVerdicts(d.designVerdictsPath))[0]?.verdict).toBe("rejected");
  });
});
