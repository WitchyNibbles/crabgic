import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { checkDemoBranchEvidenceHandoff } from "./demoBranchEvidenceHandoff.js";
import { runDemoPublication } from "./demoRun.js";

const RC = "5e2c6b5144743e2b8d846aac5c0454bb5c3ef16e";

/**
 * These exercise a REAL publication: two throwaway git repositories, 08's
 * `nameBranch` and `publishLocal`, and 17's renderer and lint. Nothing is
 * mocked, and nothing touches this checkout or any remote.
 */
describe("runDemoPublication — a real demo run", () => {
  it("publishes a neutral local branch whose name 08's namer derived", async () => {
    const result = await runDemoPublication({ releaseCandidateObjectId: RC });
    expect(result.publishStatus).toBe("published");
    expect(result.record.branchName).toMatch(/^feat\//);
    // Derived, not hand-written: the slug comes from the change description.
    expect(result.record.branchName).toContain("demo-handoff");
  });

  it("produces a three-artifact bundle that 17's own lint accepts", async () => {
    const result = await runDemoPublication({ releaseCandidateObjectId: RC });
    expect(result.record.evidenceBundle).toHaveLength(3);
    expect(result.lintFindings).toEqual([]);
    for (const path of result.record.evidenceBundle) {
      await expect(readFile(path, "utf-8")).resolves.not.toBe("");
    }
  });

  /** Gap 6: the branch and its bundle, never a push and never a PR. */
  it("performs zero remote interaction and opens no pull request", async () => {
    const result = await runDemoPublication({ releaseCandidateObjectId: RC });
    expect(result.record.remoteInteractions).toBe(0);
    expect(result.record.pullRequestOpened).toBe(false);
  });

  it("records concise commits carrying no development-engine attribution", async () => {
    const result = await runDemoPublication({ releaseCandidateObjectId: RC });
    expect(result.record.commits.length).toBeGreaterThan(0);
    for (const commit of result.record.commits) {
      expect(commit.subject.length).toBeLessThanOrEqual(72);
      expect(`${commit.subject} ${commit.body}`.toLowerCase()).not.toContain("claude");
    }
  });

  it("satisfies the release-gate check end to end", async () => {
    const result = await runDemoPublication({ releaseCandidateObjectId: RC });
    const verdict = checkDemoBranchEvidenceHandoff({
      releaseCandidateObjectId: RC,
      record: result.record,
      pathExists: () => true,
    });
    expect(verdict.reasons).toEqual([]);
    expect(verdict.verdict).toBe("PASS");
  });
});
