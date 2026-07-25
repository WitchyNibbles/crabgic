import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ARM64_CLOSE_OUT_HEADING,
  checkArm64Verification,
  extractCloseOutSection,
  readArm64RunRecord,
  readArm64VerificationInput,
  type Arm64RunRecord,
} from "./arm64Verification.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RC = "5e2c6b5144743e2b8d846aac5c0454bb5c3ef16e";

/** Mirrors exactly what `ci.yml`'s ARM64 matrix leg writes. */
function runRecord(overrides: Partial<Arm64RunRecord> = {}): Arm64RunRecord {
  return {
    workflow: "ci",
    jobName: "unit-test+coverage (ubuntu-24.04-arm)",
    runId: "1234567890",
    runAttempt: "1",
    commitSha: RC,
    arch: "aarch64",
    kernel: "Linux 6.8.0-1014-aws",
    nodeVersion: "v24.18.0",
    conclusion: "success",
    capturedAt: "2026-07-25T12:00:00Z",
    ...overrides,
  };
}

function ciInput(record: Arm64RunRecord | undefined) {
  return {
    hostArch: "x64",
    releaseCandidateObjectId: RC,
    closeOutSection: "ARM64 is verified by the ubuntu-24.04-arm CI leg.",
    runRecord: record,
  };
}

describe("extractCloseOutSection", () => {
  it("returns the section body when the heading is present", () => {
    const section = extractCloseOutSection(
      `# t\n\n${ARM64_CLOSE_OUT_HEADING}\n\nmechanism identified\n\n## Next\n\nother`,
    );
    expect(section).toContain("mechanism identified");
    expect(section).not.toContain("other");
  });

  it("returns undefined when the docs never disclose ARM64 status", () => {
    expect(extractCloseOutSection("# t\n\nnothing here")).toBeUndefined();
  });
});

describe("checkArm64Verification — native ARM64 host", () => {
  const native = { hostArch: "arm64", releaseCandidateObjectId: RC, closeOutSection: undefined };

  it("passes on a green native build+test", () => {
    const result = checkArm64Verification({
      ...native,
      runRecord: undefined,
      nativeRun: { command: "npm test", exitStatus: 0 },
    });
    expect(result.verdict).toBe("PASS");
  });

  it("FAILs on a red native build+test", () => {
    const result = checkArm64Verification({
      ...native,
      runRecord: undefined,
      nativeRun: { command: "npm test", exitStatus: 1 },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("native ARM64 build+test FAILED");
  });

  it("FAILs when the hardware route was available but not taken", () => {
    const result = checkArm64Verification({ ...native, runRecord: undefined });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("no native build+test was run");
  });
});

describe("checkArm64Verification — real-CI route", () => {
  it("passes on a green aarch64 CI run against the release candidate", () => {
    const result = checkArm64Verification(ciInput(runRecord()));
    expect(result.verdict).toBe("PASS");
    expect(result.details.join(" ")).toContain("aarch64");
  });

  /** A documented plan is not a verification — the distinction the release doc itself draws. */
  it("FAILs when no run record exists, however thoroughly the substitute is documented", () => {
    const result = checkArm64Verification(ciInput(undefined));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("not a substitute");
  });

  /**
   * The vector the old filename heuristic could not catch: a runner LABELLED
   * arm that did not actually execute on ARM64 hardware. `uname -m` is
   * recorded precisely so this is checkable.
   */
  it("FAILs when the recorded arch is not really aarch64", () => {
    const result = checkArm64Verification(ciInput(runRecord({ arch: "x86_64" })));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("runner label alone");
  });

  it("FAILs when the recorded run did not succeed", () => {
    const result = checkArm64Verification(ciInput(runRecord({ conclusion: "failure" })));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain('concluded "failure"');
  });

  it("FAILs when the run verified a different commit than the release candidate", () => {
    const result = checkArm64Verification(
      ciInput(runRecord({ commitSha: "0000000000000000000000000000000000000000" })),
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("verifies a different artifact");
  });

  it("accepts arm64 as an alias for aarch64", () => {
    expect(checkArm64Verification(ciInput(runRecord({ arch: "arm64" }))).verdict).toBe("PASS");
  });

  it("reports every distinct defect on one record", () => {
    const result = checkArm64Verification(
      ciInput(runRecord({ arch: "x86_64", conclusion: "failure", commitSha: "other" })),
    );
    expect(result.reasons).toHaveLength(3);
  });
});

describe("against the real repository", () => {
  it("reads whatever ARM64 run record has been archived", () => {
    // Asserts a shape, not a value: freezing today's (unsatisfied) release
    // state would make this test wrong the moment a real ARM64 CI run is
    // archived.
    const record = readArm64RunRecord(REPO_ROOT);
    expect(record === undefined || typeof record.arch === "string").toBe(true);
  });

  it("reads the compatibility matrix's ARM64 close-out section", () => {
    const input = readArm64VerificationInput(REPO_ROOT, RC, "x64");
    expect(input.hostArch).toBe("x64");
    expect(input.releaseCandidateObjectId).toBe(RC);
    expect(input.closeOutSection).toBeDefined();
    expect(input.nativeRun).toBeUndefined();
  });
});
