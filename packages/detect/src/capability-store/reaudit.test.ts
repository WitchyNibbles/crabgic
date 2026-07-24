import { afterEach, describe, expect, it } from "vitest";
import { freshTmpDir, removeDirTree } from "../test-support/fixture-repo.js";
import { runQuarantinePipeline } from "../quarantine/pipeline.js";
import { createCapabilityStore } from "./store.js";
import { checkReauditRequired } from "./reaudit.js";

const BENIGN_SKILL = {
  kind: "skill",
  name: "benign-skill",
  files: [{ path: "SKILL.md", content: "# ordinary\n" }],
  permissionFootprint: ["Read(./**)"],
};

describe("checkReauditRequired", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) removeDirTree(d);
  });
  function newStore() {
    const dir = freshTmpDir();
    dirs.push(dir);
    return createCapabilityStore(dir);
  }

  it("requires re-audit when no prior audit exists for the name", () => {
    const store = newStore();
    const decision = checkReauditRequired(store, "never-seen", "sha256:x", []);
    expect(decision.requiresReaudit).toBe(true);
    expect(decision.reason).toContain("no prior audit");
  });

  it("does not require re-audit when digest and permission footprint are unchanged", () => {
    const store = newStore();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    store.save(report, manifestEntry);
    const decision = checkReauditRequired(
      store,
      "benign-skill",
      report.digest,
      report.permissionFootprint,
    );
    expect(decision.requiresReaudit).toBe(false);
  });

  it("requires re-audit when the digest changed (exit criterion: 'a changed digest ... forces re-audit')", () => {
    const store = newStore();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    store.save(report, manifestEntry);
    const decision = checkReauditRequired(
      store,
      "benign-skill",
      "sha256:a-completely-different-digest",
      report.permissionFootprint,
    );
    expect(decision.requiresReaudit).toBe(true);
    expect(decision.reason).toContain("digest changed");
  });

  it("requires re-audit when the permission footprint changed (exit criterion: '... or permission footprint forces re-audit')", () => {
    const store = newStore();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    store.save(report, manifestEntry);
    const decision = checkReauditRequired(store, "benign-skill", report.digest, [
      ...report.permissionFootprint,
      "Bash(git *)",
    ]);
    expect(decision.requiresReaudit).toBe(true);
    expect(decision.reason).toContain("permission footprint changed");
  });
});
