import { afterEach, describe, expect, it } from "vitest";
import { freshTmpDir, removeDirTree } from "../test-support/fixture-repo.js";
import { createApprovalLedger } from "./approval-ledger.js";

describe("createApprovalLedger", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) removeDirTree(d);
  });
  function newRoot(): string {
    const dir = freshTmpDir();
    dirs.push(dir);
    return dir;
  }

  it("records and looks up a tokenId -> digest association", () => {
    const ledger = createApprovalLedger(newRoot());
    ledger.record("token-1", "sha256:abc");
    expect(ledger.lookup("token-1")).toBe("sha256:abc");
  });

  it("returns undefined for a tokenId never recorded", () => {
    const ledger = createApprovalLedger(newRoot());
    expect(ledger.lookup("never-recorded")).toBeUndefined();
  });

  it("persists across separate ledger instances over the same root", () => {
    const root = newRoot();
    createApprovalLedger(root).record("token-1", "sha256:abc");
    expect(createApprovalLedger(root).lookup("token-1")).toBe("sha256:abc");
  });
});
