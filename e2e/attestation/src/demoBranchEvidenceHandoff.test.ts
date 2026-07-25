import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_COMMIT_SUBJECT_LENGTH,
  checkDemoBranchEvidenceHandoff,
  findAttributionMarkers,
  readDemoBranchEvidenceHandoffInput,
  type DemoRunRecord,
} from "./demoBranchEvidenceHandoff.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RC = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

function record(overrides: Partial<DemoRunRecord> = {}): DemoRunRecord {
  return {
    branchName: "eo/change-set-42",
    objectId: RC,
    commits: [{ subject: "feat: add the widget", body: "Implements the widget." }],
    evidenceBundle: ["docs/evidence/phase-23/demo/pr-title.txt"],
    remoteInteractions: 0,
    pullRequestOpened: false,
    ...overrides,
  };
}

const ALWAYS_EXISTS = (): boolean => true;

function input(overrides: Partial<DemoRunRecord> = {}) {
  return { releaseCandidateObjectId: RC, record: record(overrides), pathExists: ALWAYS_EXISTS };
}

describe("findAttributionMarkers", () => {
  it("detects development-engine attribution case-insensitively", () => {
    expect(findAttributionMarkers("Co-Authored-By: Claude")).toContain("claude");
    expect(findAttributionMarkers("GENERATED WITH something")).toContain("generated with");
  });

  it("returns nothing for a neutral string", () => {
    expect(findAttributionMarkers("feat: add the widget")).toEqual([]);
  });
});

describe("checkDemoBranchEvidenceHandoff — PASS", () => {
  it("passes on a neutral, local-only, evidence-backed demo run", () => {
    const result = checkDemoBranchEvidenceHandoff(input());
    expect(result.verdict).toBe("PASS");
  });
});

describe("checkDemoBranchEvidenceHandoff — seeded defects each FAIL", () => {
  it("FAILs when no demo run was recorded at all", () => {
    const result = checkDemoBranchEvidenceHandoff({
      releaseCandidateObjectId: RC,
      record: undefined,
      pathExists: ALWAYS_EXISTS,
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("no demo run recorded");
  });

  it("FAILs on attribution in a commit body — 08/17's neutrality invariant", () => {
    const result = checkDemoBranchEvidenceHandoff(
      input({ commits: [{ subject: "feat: x", body: "Co-Authored-By: Claude" }] }),
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("development-engine attribution");
  });

  it("FAILs on attribution in the branch name", () => {
    const result = checkDemoBranchEvidenceHandoff(input({ branchName: "claude/fix-things" }));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("branch name");
  });

  it("FAILs on any remote interaction — the demo run must be local-only", () => {
    const result = checkDemoBranchEvidenceHandoff(input({ remoteInteractions: 1 }));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("must be local-only");
  });

  it("FAILs when a PR was opened — Gap 6, by design", () => {
    const result = checkDemoBranchEvidenceHandoff(input({ pullRequestOpened: true }));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("never a PR");
  });

  it("FAILs on a branch with no commits", () => {
    const result = checkDemoBranchEvidenceHandoff(input({ commits: [] }));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("no commits");
  });

  it("FAILs on a commit subject over the concise-commit limit", () => {
    const result = checkDemoBranchEvidenceHandoff(
      input({ commits: [{ subject: "f".repeat(MAX_COMMIT_SUBJECT_LENGTH + 1), body: "" }] }),
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("concise-commit limit");
  });

  it("FAILs on an empty evidence bundle", () => {
    const result = checkDemoBranchEvidenceHandoff(input({ evidenceBundle: [] }));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("not evidence-backed");
  });

  it("FAILs when a bundle artifact does not resolve", () => {
    const result = checkDemoBranchEvidenceHandoff({ ...input(), pathExists: () => false });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("do not resolve");
  });

  it("FAILs when the branch came from a different object ID", () => {
    const result = checkDemoBranchEvidenceHandoff(input({ objectId: "other" }));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("not the release candidate");
  });
});

describe("readDemoBranchEvidenceHandoffInput — against the real repository", () => {
  it("reads whatever demo-run record exists", () => {
    const result = readDemoBranchEvidenceHandoffInput(REPO_ROOT, RC);
    expect(result.releaseCandidateObjectId).toBe(RC);
    expect(result.pathExists("docs/engine-baseline.md")).toBe(true);
  });
});
