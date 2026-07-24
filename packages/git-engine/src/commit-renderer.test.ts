import { describe, expect, it } from "vitest";
import {
  assembleCommitBody,
  assembleCommitSubject,
  renderCommit,
  type RenderCommitInput,
} from "./commit-renderer.js";

/**
 * roadmap/08-integration-publication.md work item 4 — "golden corpus (bad
 * subjects, over-long bodies, attribution leaks — shared fixture with 17)."
 * This file exercises `renderCommit`'s own assembly/blocking behavior; the
 * REUSE of 17's exact shared corpus fixtures (not a forked copy) lives in
 * `./renderer-corpus-shared.test.ts`, per the roadmap's own "reuse (not
 * fork)" Conformance bullet.
 */

function baseInput(overrides: Partial<RenderCommitInput> = {}): RenderCommitInput {
  return {
    type: "fix",
    scope: "parser",
    outcome: "correct the off-by-one in the tokenizer",
    why: "the tokenizer dropped the final character on every input",
    risk: "low — isolated to the tokenizer's boundary check",
    compat: "no public API change",
    verification: "unit test added; full suite green",
    ...overrides,
  };
}

describe("assembleCommitSubject / assembleCommitBody", () => {
  it("assembles type(scope): outcome", () => {
    expect(assembleCommitSubject(baseInput())).toBe(
      "fix(parser): correct the off-by-one in the tokenizer",
    );
  });

  it("omits the scope parens when scope is absent", () => {
    const { scope, ...rest } = baseInput();
    void scope;
    expect(assembleCommitSubject(rest)).toBe("fix: correct the off-by-one in the tokenizer");
  });

  it("assembles a 4-line Why/Risk/Compat/Verification body", () => {
    const body = assembleCommitBody(baseInput());
    expect(body.split("\n")).toEqual([
      "Why: the tokenizer dropped the final character on every input",
      "Risk: low — isolated to the tokenizer's boundary check",
      "Compat: no public API change",
      "Verification: unit test added; full suite green",
    ]);
  });
});

describe("renderCommit", () => {
  it("renders a clean subject+body through 17's renderWithRegeneration()", async () => {
    const result = await renderCommit(baseInput());
    expect(result).toEqual({
      status: "rendered",
      subject: "fix(parser): correct the off-by-one in the tokenizer",
      body: [
        "Why: the tokenizer dropped the final character on every input",
        "Risk: low — isolated to the tokenizer's boundary check",
        "Compat: no public API change",
        "Verification: unit test added; full suite green",
      ].join("\n"),
    });
  });

  it("blocks on an over-long subject (never reaches the body render at all)", async () => {
    const result = await renderCommit(baseInput({ outcome: "x".repeat(200) }));
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.which).toBe("subject");
    }
  });

  it("blocks when the body carries an attribution leak, even though the subject alone is clean", async () => {
    const result = await renderCommit(
      baseInput({ why: "🤖 Generated with Claude Code and Co-Authored-By: Claude" }),
    );
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.which).toBe("body");
      expect(result.findings.length).toBeGreaterThan(0);
    }
  });

  it("blocks when the body exceeds the 5-line limit", async () => {
    const result = await renderCommit(
      baseInput({
        why: "line one\nline two\nline three\nline four\nline five\nline six",
      }),
    );
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.which).toBe("body");
    }
  });
});
