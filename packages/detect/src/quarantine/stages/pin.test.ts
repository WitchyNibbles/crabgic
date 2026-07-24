import { describe, expect, it } from "vitest";
import type { CandidateSource } from "../types.js";
import { computeCandidateDigest } from "../digest.js";
import { runPinStage } from "./pin.js";

const CANDIDATE: CandidateSource = {
  kind: "skill",
  name: "example-skill",
  files: [{ path: "SKILL.md", content: "# Example\n" }],
  permissionFootprint: [],
};

describe("runPinStage", () => {
  it("pins the exact digest computeCandidateDigest would compute", () => {
    const outcome = runPinStage(CANDIDATE);
    expect(outcome.pinned.digest).toBe(computeCandidateDigest(CANDIDATE));
    expect(outcome.result.passed).toBe(true);
  });

  it("carries every original field forward onto the pinned candidate", () => {
    const outcome = runPinStage(CANDIDATE);
    expect(outcome.pinned.name).toBe(CANDIDATE.name);
    expect(outcome.pinned.kind).toBe(CANDIDATE.kind);
    expect(outcome.pinned.files).toEqual(CANDIDATE.files);
  });
});
