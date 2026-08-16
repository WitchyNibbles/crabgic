import { describe, expect, it } from "vitest";
import {
  assembleCommitBody,
  assembleCommitSubject,
  renderCommit,
  wrapCommitFooter,
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

/**
 * COMMITLINT CONFORMANCE — measured on PR #139 (2026-08-16), the first PR made
 * of worker-authored commits. CI's `commitlint` job rejected it:
 *
 *     ✖ subject must not be sentence-case, start-case, pascal-case, upper-case
 *     ✖ footer's lines must not be longer than 100 characters
 *
 * Both come from this renderer, not from that one commit, so EVERY commit a
 * worker produces fails this repository's own conventional-commit contract.
 * The system can author code it cannot land.
 *
 * `outcome` is sourced from a `WorkUnit`/`Requirement` title — human-written,
 * and titles are conventionally capitalised — so the renderer has to do the
 * lowering. The footer lines interpolate `rollbackStrategy` and an owned-path
 * list, both unbounded, so they have to be wrapped.
 */
describe("commitlint conformance", () => {
  const longInput = {
    type: "chore" as const,
    outcome: "Close the three admissibility clean-code advisories",
    why: "role implementation, 3 declared requirement(s)",
    risk: "rollback: Revert the integration commit. The change is confined to one module and its test file, and alters no persisted state or schema.",
    compat:
      "writes confined to packages/cli/src/review/admissibility.ts, packages/cli/src/review/admissibility.test.ts",
    verification: "merge-tree preflighted against the integration tip, CAS-landed",
  };

  it("lowers a sentence-case outcome — commitlint's subject-case rule", () => {
    expect(assembleCommitSubject(longInput)).toBe(
      "chore: close the three admissibility clean-code advisories",
    );
  });

  it("leaves an identifier's own capitalisation alone — only the FIRST letter lowers", () => {
    // Lowercasing the whole subject would mangle `TaskPacket` into `taskpacket`,
    // which is worse than the problem: commitlint objects to sentence-case, not
    // to capitals anywhere.
    expect(
      assembleCommitSubject({ ...longInput, outcome: "Add TaskPacket.spec passthrough" }),
    ).toBe("chore: add TaskPacket.spec passthrough");
  });

  it("wraps every footer line to 100 characters — in what actually reaches git", async () => {
    // Asserted on `renderCommit`'s output, not on `assembleCommitBody`: the
    // wrap happens after the policy check, and what commitlint reads is the
    // rendered body.
    const rendered = await renderCommit(longInput);
    expect(rendered.status).toBe("rendered");
    if (rendered.status !== "rendered") return;
    for (const line of rendered.body.split("\n")) {
      expect(
        line.length,
        `"${line.slice(0, 40)}…" is ${String(line.length)} chars`,
      ).toBeLessThanOrEqual(100);
    }
  });

  it("keeps every footer key on a line start, so the trailer stays parseable", async () => {
    // The negative control for the wrap: a wrap that folded `Compat:` onto the
    // previous line would satisfy the length rule and destroy the footer.
    const rendered = await renderCommit(longInput);
    if (rendered.status !== "rendered") throw new Error("expected a rendered commit");
    const lines = rendered.body.split("\n");
    for (const key of ["Why:", "Risk:", "Compat:", "Verification:"]) {
      expect(lines.some((line) => line.startsWith(key))).toBe(true);
    }
  });

  it("PRESERVES hard breaks, so the five-line body guard still fires", () => {
    // Found while writing the wrap: splitting on /\s+/ collapsed the author's
    // own newlines, so a genuinely six-line body became one long line and
    // slipped past the policy. The guard is checked before wrapping AND the
    // wrap keeps the breaks.
    expect(wrapCommitFooter("Why: one\ntwo\nthree").split("\n")).toHaveLength(3);
  });
});
