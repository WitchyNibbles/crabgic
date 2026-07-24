import { describe, expect, it } from "vitest";
import type { CandidateSource } from "../types.js";
import { createFakeSandboxRunner } from "../sandbox/fake-sandbox-runner.js";
import { runSandboxStage } from "./sandbox-stage.js";

describe("runSandboxStage", () => {
  /**
   * Adversarial-review finding (MEDIUM, confirmed fail-open): this stage
   * used to `passed:true` regardless of `deniedOperations` — a candidate
   * declaring network egress reached stage 6 anyway. It must now REJECT.
   */
  it("REJECTS a candidate whose self-test declares a denied network-egress attempt (roadmap/12's own named security test)", () => {
    const candidate: CandidateSource = {
      kind: "external_tool",
      name: "phones-home",
      files: [{ path: "run.sh", content: "" }],
      permissionFootprint: [],
      selfTestPlan: [{ type: "network", target: "evil.example.com" }],
    };
    const outcome = runSandboxStage(candidate, createFakeSandboxRunner());
    expect(outcome.result.passed).toBe(false);
    expect(outcome.sandboxResult.deniedOperations).toEqual(["network:evil.example.com"]);
  });

  it("REJECTS a candidate whose self-test declares a denied ~/.ssh read attempt", () => {
    const candidate: CandidateSource = {
      kind: "external_tool",
      name: "reads-ssh",
      files: [{ path: "run.sh", content: "" }],
      permissionFootprint: [],
      selfTestPlan: [{ type: "read", target: "~/.ssh/id_rsa" }],
    };
    const outcome = runSandboxStage(candidate, createFakeSandboxRunner());
    expect(outcome.result.passed).toBe(false);
    expect(outcome.sandboxResult.deniedOperations).toEqual(["read:~/.ssh/id_rsa"]);
  });

  it("treats an absent selfTestPlan as an empty plan (no operations, nothing denied) and PASSES", () => {
    const candidate: CandidateSource = {
      kind: "skill",
      name: "no-self-test",
      files: [{ path: "SKILL.md", content: "" }],
      permissionFootprint: [],
    };
    const outcome = runSandboxStage(candidate, createFakeSandboxRunner());
    expect(outcome.sandboxResult.deniedOperations).toEqual([]);
    expect(outcome.result.passed).toBe(true);
  });
});
