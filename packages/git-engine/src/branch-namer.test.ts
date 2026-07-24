import { describe, expect, it } from "vitest";
import {
  BRANCH_TYPES,
  InvalidBranchTypeError,
  MAX_BRANCH_NAME_LENGTH,
  buildBranchNameCandidate,
  nameBranch,
  slugify,
} from "./branch-namer.js";

/**
 * roadmap/08-integration-publication.md work item 3 — "Branch namer
 * (`nameBranch`) + property tests (length, charset, type set, collision
 * suffix) + `renderWithRegeneration()` call for `branch_name`. Failing-
 * first: a seeded slug containing an attribution token must be blocked by
 * 17's lint before any git-ref-legality concern is even reached."
 */

const GIT_REF_LEGAL = /^[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*$/;

describe("slugify", () => {
  it("lowercases, hyphenates, and collapses non-alphanumeric runs", () => {
    expect(slugify("Add Blocking Lint Pipeline!!")).toBe("add-blocking-lint-pipeline");
  });

  it("falls back to a non-empty slug for all-non-alphanumeric input", () => {
    expect(slugify("!!!???")).toBe("change");
  });
});

describe("buildBranchNameCandidate", () => {
  it("builds <type>/<slug> for a clean input", () => {
    expect(
      buildBranchNameCandidate({ type: "feat", slugSource: "add renderer lint pipeline" }),
    ).toBe("feat/add-renderer-lint-pipeline");
  });

  it("embeds a validated JIRA key as <type>/<JIRA-KEY>-<slug>", () => {
    expect(
      buildBranchNameCandidate({
        type: "fix",
        jiraKey: "abc-123",
        slugSource: "correct the parser",
      }),
    ).toBe("fix/ABC-123-correct-the-parser");
  });

  it("ignores a malformed JIRA key rather than embedding garbage", () => {
    expect(
      buildBranchNameCandidate({ type: "fix", jiraKey: "not a key!!", slugSource: "correct it" }),
    ).toBe("fix/correct-it");
  });

  it("never exceeds 64 chars even for a very long slug source", () => {
    const candidate = buildBranchNameCandidate({
      type: "refactor",
      slugSource: "a".repeat(500),
    });
    expect(candidate.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    expect(candidate).toMatch(GIT_REF_LEGAL);
  });

  it("appends a monotonically increasing collision suffix", () => {
    const first = buildBranchNameCandidate({ type: "chore", slugSource: "bump deps" });
    const second = buildBranchNameCandidate({
      type: "chore",
      slugSource: "bump deps",
      existingBranchNames: [first],
    });
    const third = buildBranchNameCandidate({
      type: "chore",
      slugSource: "bump deps",
      existingBranchNames: [first, second],
    });
    expect(second).toBe(`${first}-2`);
    expect(third).toBe(`${first}-3`);
    expect(second.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    expect(third.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
  });

  it("keeps a suffixed collision candidate within 64 chars even for a maximally long slug", () => {
    const first = buildBranchNameCandidate({ type: "security", slugSource: "z".repeat(500) });
    const second = buildBranchNameCandidate({
      type: "security",
      slugSource: "z".repeat(500),
      existingBranchNames: [first],
    });
    expect(second.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    expect(second).toMatch(GIT_REF_LEGAL);
    expect(second).not.toBe(first);
  });

  it("trims the slug further once even a long numeric collision suffix (-1000) would overflow 64 chars", () => {
    const names: string[] = [];
    for (let i = 0; i < 999; i++) {
      const candidate = buildBranchNameCandidate({
        type: "chore",
        slugSource: "z".repeat(500),
        existingBranchNames: names,
      });
      names.push(candidate);
    }
    // The 1000th collision needs a "-1000" (5-char) suffix — 1 char past
    // the reserved 4-char headroom — proving the slug is trimmed further
    // rather than ever exceeding 64 chars.
    const next = buildBranchNameCandidate({
      type: "chore",
      slugSource: "z".repeat(500),
      existingBranchNames: names,
    });
    expect(next.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    expect(next).toMatch(GIT_REF_LEGAL);
    expect(names).not.toContain(next);
  });

  it("rejects a type outside the closed 9-member set", () => {
    expect(() =>
      buildBranchNameCandidate({
        // @ts-expect-error — deliberately invalid at the type level too
        type: "not-a-real-type",
        slugSource: "whatever",
      }),
    ).toThrow(InvalidBranchTypeError);
  });

  it("accepts every one of the 9 closed branch types", () => {
    for (const type of BRANCH_TYPES) {
      const candidate = buildBranchNameCandidate({ type, slugSource: "x" });
      expect(candidate.startsWith(`${type}/`)).toBe(true);
    }
  });
});

describe("nameBranch", () => {
  it("renders a clean candidate through 17's renderWithRegeneration()", async () => {
    const result = await nameBranch({ type: "feat", slugSource: "add a new capability" });
    expect(result).toEqual({ status: "named", branchName: "feat/add-a-new-capability" });
  });

  it("blocks a slug carrying an attribution token, even though it is charset/length-legal", async () => {
    // "co-authored-by" slugifies to a perfectly ref-legal token — the
    // roadmap's own failing-first case: legality alone must NOT be enough.
    const result = await nameBranch({
      type: "chore",
      slugSource: "co-authored-by claude",
    });
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.error).toBe("policy_blocked");
      expect(result.findings.length).toBeGreaterThan(0);
    }
  });
});
