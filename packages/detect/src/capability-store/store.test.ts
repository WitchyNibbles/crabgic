import { afterEach, describe, expect, it } from "vitest";
import { freshTmpDir, removeDirTree } from "../test-support/fixture-repo.js";
import { runQuarantinePipeline } from "../quarantine/pipeline.js";
import { createCapabilityStore } from "./store.js";
import { computeCapabilityStoreKey } from "./key.js";

const BENIGN_SKILL = {
  kind: "skill",
  name: "benign-skill",
  files: [{ path: "SKILL.md", content: "# ordinary\n" }],
  permissionFootprint: ["Read(./**)"],
};

describe("createCapabilityStore", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) removeDirTree(d);
  });
  function newRoot(): string {
    const dir = freshTmpDir();
    dirs.push(dir);
    return dir;
  }

  it("saves and loads back an audit report + manifest entry under the correct content-addressed key", () => {
    const root = newRoot();
    const store = createCapabilityStore(root);
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);

    const saved = store.save(report, manifestEntry);
    expect(saved.key).toBe(computeCapabilityStoreKey(report.digest, report.permissionFootprint));

    const loaded = store.load(saved.key);
    expect(loaded?.report).toEqual(report);
    expect(loaded?.manifestEntry).toEqual(manifestEntry);
  });

  it("returns undefined loading a key that was never saved", () => {
    const store = createCapabilityStore(newRoot());
    expect(store.load("nonexistent-key")).toBeUndefined();
  });

  it("updateDecision flips a stored entry's decision on both the report and the manifest entry", () => {
    const store = createCapabilityStore(newRoot());
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = store.save(report, manifestEntry);

    const updated = store.updateDecision(saved.key, "approved");
    expect(updated.report.decision).toBe("approved");
    expect(updated.manifestEntry).toMatchObject({ decision: "approved" });

    const reloaded = store.load(saved.key);
    expect(reloaded?.report.decision).toBe("approved");
    expect(reloaded?.manifestEntry).toMatchObject({ decision: "approved" });
  });

  it("updateDecision throws for an unknown key", () => {
    const store = createCapabilityStore(newRoot());
    expect(() => store.updateDecision("nonexistent-key", "approved")).toThrow();
  });

  it("list() returns every saved entry", () => {
    const store = createCapabilityStore(newRoot());
    const first = runQuarantinePipeline(BENIGN_SKILL);
    const second = runQuarantinePipeline({ ...BENIGN_SKILL, name: "another-skill" });
    store.save(first.report, first.manifestEntry);
    store.save(second.report, second.manifestEntry);
    expect(store.list()).toHaveLength(2);
  });

  it("findLatestByName resolves the latest entry saved for a given capability name", () => {
    const store = createCapabilityStore(newRoot());
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    store.save(report, manifestEntry);
    const found = store.findLatestByName("benign-skill");
    expect(found?.report.digest).toBe(report.digest);
  });

  it("findLatestByName returns undefined for a name never saved", () => {
    const store = createCapabilityStore(newRoot());
    expect(store.findLatestByName("never-seen")).toBeUndefined();
  });

  it("findByDigest resolves the entry whose report.digest matches, ignoring by-name/approvals bookkeeping directories", () => {
    const store = createCapabilityStore(newRoot());
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    store.save(report, manifestEntry);
    expect(store.findByDigest(report.digest)?.report.digest).toBe(report.digest);
  });

  it("findByDigest returns undefined for a digest never saved", () => {
    const store = createCapabilityStore(newRoot());
    expect(store.findByDigest("sha256:never-saved")).toBeUndefined();
  });

  it("persists real files to disk under the given root (content-addressed, on-disk store — not merely in-memory)", () => {
    const root = newRoot();
    const store = createCapabilityStore(root);
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = store.save(report, manifestEntry);

    // A brand-new store instance over the SAME root sees the same data.
    const reopened = createCapabilityStore(root);
    expect(reopened.load(saved.key)?.report.digest).toBe(report.digest);
  });
});
