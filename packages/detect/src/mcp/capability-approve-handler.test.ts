import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalTokenMinter } from "engineering-orchestrator";
import { freshTmpDir, removeDirTree } from "../test-support/fixture-repo.js";
import { createCapabilityStore } from "../capability-store/store.js";
import { runQuarantinePipeline } from "../quarantine/pipeline.js";
import { runCapabilityApprove } from "./capability-approve-handler.js";

const BENIGN_SKILL = {
  kind: "skill",
  name: "benign-skill",
  files: [{ path: "SKILL.md", content: "# ordinary\n" }],
  permissionFootprint: ["Read(./**)"],
};

describe("runCapabilityApprove", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) removeDirTree(d);
  });
  function newStore() {
    const dir = freshTmpDir();
    dirs.push(dir);
    return createCapabilityStore(dir);
  }

  it("approves and flips the stored decision when verifying a genuinely pre-minted trust-approve token", async () => {
    const store = newStore();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = store.save(report, manifestEntry);
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
    const minted = await minter.mint("capability_digest", report.digest);

    const result = runCapabilityApprove(
      { digest: report.digest, token: minted.token },
      { minter, store, storeKey: saved.key },
    );

    expect(result).toEqual({ approved: true });
    expect(store.load(saved.key)?.report.decision).toBe("approved");
  });

  it("fails closed (never approves) for a model-self-approval attempt with NO pre-minted token (roadmap/12's own named seeded threat)", () => {
    const store = newStore();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = store.save(report, manifestEntry);
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });

    const result = runCapabilityApprove(
      { digest: report.digest, token: "totally-fabricated-token-nobody-minted" },
      { minter, store, storeKey: saved.key },
    );

    expect(result.approved).toBe(false);
    expect(store.load(saved.key)?.report.decision).toBe("pending");
  });

  it("fails closed for a token minted against a DIFFERENT digest (mismatch never verifies)", async () => {
    const store = newStore();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = store.save(report, manifestEntry);
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
    const minted = await minter.mint("capability_digest", "sha256:some-other-digest-entirely");

    const result = runCapabilityApprove(
      { digest: report.digest, token: minted.token },
      { minter, store, storeKey: saved.key },
    );
    expect(result.approved).toBe(false);
  });

  it("fails closed replaying an already-consumed token (single-use)", async () => {
    const store = newStore();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = store.save(report, manifestEntry);
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
    const minted = await minter.mint("capability_digest", report.digest);

    const first = runCapabilityApprove(
      { digest: report.digest, token: minted.token },
      { minter, store, storeKey: saved.key },
    );
    expect(first.approved).toBe(true);

    const replay = runCapabilityApprove(
      { digest: report.digest, token: minted.token },
      { minter, store, storeKey: saved.key },
    );
    expect(replay.approved).toBe(false);
  });

  it("fails closed for a token minted under subjectKind envelope_hash (11's subject), never satisfying capability_digest", async () => {
    const store = newStore();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = store.save(report, manifestEntry);
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
    const minted = await minter.mint("envelope_hash", report.digest);

    const result = runCapabilityApprove(
      { digest: report.digest, token: minted.token },
      { minter, store, storeKey: saved.key },
    );
    expect(result.approved).toBe(false);
  });
});
