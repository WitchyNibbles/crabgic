import { COMMUNICATION_POLICY_LIMITS } from "@crabgic/contracts";
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

  /**
   * The subject render still SHORT-CIRCUITS the body render — but length is no
   * longer what can trip it. `assembleCommitSubject` bounds the outcome to the
   * policy's own budget (see "bounds a long outcome..." below, and run
   * `70059608`), so the reachable subject blocks are the content ones. An
   * attribution leak is one, and it must be refused rather than trimmed away:
   * silently deleting the leak would publish a commit whose message the policy
   * never actually cleared.
   */
  it("blocks on a subject the policy refuses, never reaching the body render", async () => {
    const result = await renderCommit(
      baseInput({ outcome: "Co-Authored-By: Claude <noreply@anthropic.com>" }),
    );
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

  /**
   * ⚠️ MEASURED IN PRODUCTION, run `70059608` (2026-09-06). The title below is
   * verbatim from that run's first work unit: it rendered a 75-char subject,
   * `renderWithRegeneration` blocked it, `collectCandidate` returned `blocked`,
   * and the unit's finished work — 34 worker turns, $1.57 — was never
   * committed. Two of that run's four units were over the limit (75 and 76).
   *
   * Regeneration cannot save a DETERMINISTIC generator: it re-runs `generate`,
   * which reassembles the same over-long subject. So the bound belongs where
   * the subject is assembled, and it is the POLICY's own bound rather than a
   * second copy of 72.
   */
  it("bounds a long outcome to the policy's own subject limit instead of blocking", async () => {
    const overLong = {
      ...longInput,
      type: "feat" as const,
      outcome: "Enumeration and mtime primitives: units.mjs and walk.mjs, tests first",
    };
    const subject = assembleCommitSubject(overLong);
    expect(subject.length).toBeLessThanOrEqual(COMMUNICATION_POLICY_LIMITS.commitSubject.maxChars);
    // Trimmed at a WORD boundary, and with no trailing punctuation --
    // commitlint's `subject-full-stop` rejects a trailing period, so an
    // ellipsis would trade one block for another.
    expect(subject).toBe("feat: enumeration and mtime primitives: units.mjs and walk.mjs, tests");
    // ...and the whole point: it renders rather than blocking.
    const rendered = await renderCommit(overLong);
    expect(rendered.status).toBe("rendered");
  });

  it("leaves a subject that already fits exactly as it is", () => {
    // The bound must not nibble at a subject the policy accepts: `longInput`
    // is 57 chars and has to survive byte-for-byte.
    expect(assembleCommitSubject(longInput)).toBe(
      "chore: close the three admissibility clean-code advisories",
    );
  });

  /**
   * A single word longer than the whole budget has no word boundary to cut at.
   * Trimming to nothing would produce `chore: `, which fails the format check
   * — so the hard cut is taken and the subject stays within the limit.
   */
  it("hard-cuts a single unbroken token rather than emptying the subject", () => {
    const subject = assembleCommitSubject({ ...longInput, outcome: "A".repeat(200) });
    expect(subject.length).toBe(COMMUNICATION_POLICY_LIMITS.commitSubject.maxChars);
    expect(subject.startsWith("chore: a")).toBe(true);
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
