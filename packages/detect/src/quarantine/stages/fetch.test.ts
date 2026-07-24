import { describe, expect, it } from "vitest";
import { runFetchStage } from "./fetch.js";

const VALID = {
  kind: "skill",
  name: "example-skill",
  files: [{ path: "SKILL.md", content: "# Example\n" }],
  permissionFootprint: [],
};

describe("runFetchStage", () => {
  it("passes and returns a validated candidate for a well-shaped, credential-free descriptor", () => {
    const outcome = runFetchStage(VALID);
    expect(outcome.result.passed).toBe(true);
    expect(outcome.candidate?.name).toBe("example-skill");
  });

  it("rejects a descriptor carrying a top-level 'credentials' field ('fetch without credentials')", () => {
    const outcome = runFetchStage({ ...VALID, credentials: { token: "abc" } });
    expect(outcome.result.passed).toBe(false);
    expect(outcome.candidate).toBeUndefined();
  });

  it("rejects a descriptor carrying a top-level 'apiKey' field", () => {
    const outcome = runFetchStage({ ...VALID, apiKey: "sk-123" });
    expect(outcome.result.passed).toBe(false);
  });

  it("rejects a malformed descriptor (missing required fields) without throwing", () => {
    expect(() => runFetchStage({ kind: "skill" })).not.toThrow();
    expect(runFetchStage({ kind: "skill" }).result.passed).toBe(false);
  });

  it("rejects a completely non-object input without throwing", () => {
    expect(runFetchStage("not an object").result.passed).toBe(false);
    expect(runFetchStage(null).result.passed).toBe(false);
    expect(runFetchStage(undefined).result.passed).toBe(false);
  });
});
