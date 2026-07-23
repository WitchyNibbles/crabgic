import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { lint, STAGE_PIPELINE } from "./lint.js";

describe("STAGE_PIPELINE — runner order (work item 1 failing-first fixture)", () => {
  it("declares exactly the 11 stages from roadmap/17 §Goal's arrow-chain, in that order", () => {
    expect(STAGE_PIPELINE.length).toBe(11);
  });

  it("runs every stage against a clean candidate with no findings", () => {
    expect(lint("Corrects the off-by-one error.", "commit_body", DEFAULT_COMMUNICATION_POLICY)).toEqual({
      ok: true,
    });
  });
});

describe("lint()", () => {
  it("returns ok:true for a clean commit subject", () => {
    expect(lint("fix: correct the off-by-one error", "commit_subject", DEFAULT_COMMUNICATION_POLICY)).toEqual({
      ok: true,
    });
  });

  it("aggregates findings across multiple stages in a single pass (never short-circuits)", () => {
    // Both an attribution violation AND a secret leak, in one candidate.
    const dirty = "🤖 Generated with Claude Code\nAKIAABCDEFGHIJKLMNOP";
    const outcome = lint(dirty, "commit_body", DEFAULT_COMMUNICATION_POLICY);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      const stages = new Set(outcome.findings.map((f) => f.stage));
      expect(stages.has("attribution-neutral")).toBe(true);
      expect(stages.has("secret-scan")).toBe(true);
    }
  });

  it("every finding carries stage/severity/message, never a bare boolean", () => {
    const outcome = lint("AKIAABCDEFGHIJKLMNOP", "commit_body", DEFAULT_COMMUNICATION_POLICY);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      for (const finding of outcome.findings) {
        expect(typeof finding.stage).toBe("string");
        expect(finding.severity).toBe("block");
        expect(typeof finding.message).toBe("string");
      }
    }
  });

  it("is pure — repeated calls with the same input return an equivalent outcome", () => {
    const a = lint("fix: correct the parser", "commit_subject", DEFAULT_COMMUNICATION_POLICY);
    const b = lint("fix: correct the parser", "commit_subject", DEFAULT_COMMUNICATION_POLICY);
    expect(a).toEqual(b);
  });
});
