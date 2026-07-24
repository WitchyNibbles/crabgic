import { afterEach, describe, expect, it } from "vitest";
import { freshTmpDir, removeDirTree } from "../test-support/fixture-repo.js";
import { createCapabilityStore } from "../capability-store/store.js";
import { runCapabilityAudit } from "./capability-audit-handler.js";

const BENIGN_SKILL = {
  kind: "skill",
  name: "benign-skill",
  files: [{ path: "SKILL.md", content: "# ordinary\n" }],
  permissionFootprint: ["Read(./**)"],
};

describe("runCapabilityAudit", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) removeDirTree(d);
  });
  function newStore() {
    const dir = freshTmpDir();
    dirs.push(dir);
    return createCapabilityStore(dir);
  }

  it("runs the pipeline, persists the report into the store, and reports 'no prior audit' the first time", () => {
    const store = newStore();
    const { report, reaudit } = runCapabilityAudit({ candidate: BENIGN_SKILL }, { store });
    expect(report.decision).toBe("pending");
    expect(reaudit?.requiresReaudit).toBe(true);
    expect(reaudit?.reason).toContain("no prior audit");
    expect(store.list()).toHaveLength(1);
  });

  it("reports no re-audit required for a second, byte-identical audit of the same candidate", () => {
    const store = newStore();
    runCapabilityAudit({ candidate: BENIGN_SKILL }, { store });
    const { reaudit } = runCapabilityAudit({ candidate: BENIGN_SKILL }, { store });
    expect(reaudit?.requiresReaudit).toBe(false);
  });

  it("reports re-audit required when the candidate's content changed since the last audit", () => {
    const store = newStore();
    runCapabilityAudit({ candidate: BENIGN_SKILL }, { store });
    const { reaudit } = runCapabilityAudit(
      { candidate: { ...BENIGN_SKILL, files: [{ path: "SKILL.md", content: "# updated\n" }] } },
      { store },
    );
    expect(reaudit?.requiresReaudit).toBe(true);
    expect(reaudit?.reason).toContain("digest changed");
  });

  it("still runs and persists the (rejected) report for an invalid candidate, with no reaudit info", () => {
    const store = newStore();
    const { report, reaudit } = runCapabilityAudit({ candidate: { kind: "skill" } }, { store });
    expect(report.decision).toBe("rejected");
    expect(reaudit).toBeUndefined();
  });

  /**
   * Adversarial-review finding (LOW/MEDIUM, confirmed dead guard): the
   * unsigned-digest-swap provenance guard (stage 3) used to never fire in
   * production because `runCapabilityAudit` never threaded the store's
   * previous digest into `runQuarantinePipeline` — only a hand-built test
   * calling the pipeline directly with a manually-injected
   * `previousDigest` ever exercised it. This test goes through the REAL
   * handler entry point only (no manual injection) and proves the guard
   * now genuinely fires: a second audit of the SAME capability name with
   * DIFFERENT content and no accompanying valid signature is rejected at
   * `verify_provenance`, never reaches `scan`/`sandbox_test`/
   * `manifest_entry`.
   */
  it("REJECTS at stage verify_provenance on a real unsigned digest swap, reached only through runCapabilityAudit itself", () => {
    const store = newStore();
    const first = runCapabilityAudit({ candidate: BENIGN_SKILL }, { store });
    expect(first.report.decision).toBe("pending");

    const second = runCapabilityAudit(
      { candidate: { ...BENIGN_SKILL, files: [{ path: "SKILL.md", content: "# updated\n" }] } },
      { store },
    );
    expect(second.report.stages.map((s) => s.stage)).toEqual(["fetch", "pin", "verify_provenance"]);
    expect(second.report.stages.at(-1)?.passed).toBe(false);
    expect(second.report.decision).toBe("rejected");
  });

  it("does NOT reject a second, byte-identical audit (unchanged digest never trips the swap guard)", () => {
    const store = newStore();
    runCapabilityAudit({ candidate: BENIGN_SKILL }, { store });
    const second = runCapabilityAudit({ candidate: BENIGN_SKILL }, { store });
    expect(second.report.decision).toBe("pending");
  });
});
