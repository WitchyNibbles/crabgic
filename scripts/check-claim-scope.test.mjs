/**
 * Unit tests for the claim-scope check — the second half of the remedy the
 * repo-navigability research landed on (`docs/evidence/phase-26/`).
 *
 * WHY THIS EXISTS. `scripts/repo-census.mjs` answers "what regions exist and
 * which enumeration claims them". It does not stop the specific mistake that
 * started all this: a UNIVERSAL claim backed by a SCOPED search.
 *
 * Measured, in this repository: a research record's Q2 asserted "nothing
 * already detects it" — a universal negative over the whole repo — and cited
 * two directory-scoped searches, `packages/cli/src/doctor/checks/` and
 * `check:all`. `scripts/bundle-types.mjs:70` implements exactly the thing it
 * said nothing implemented. The corpus was narrower than the quantifier, and
 * ten review rounds inherited the mismatch because the searches themselves were
 * correct — only their SCOPE was wrong for the claim they were offered for.
 *
 * The rule this encodes: **the corpus must be at least as wide as the claim's
 * quantifier.** It is a static check over prose and the commands quoted beside
 * it. It cannot know whether a search was well-chosen; it can see when a
 * repo-wide claim rests on a directory-scoped command, which is the one thing
 * nobody noticed for ten rounds.
 */
import { describe, expect, it } from "vitest";
import { classifySearchCorpus, findScopeMismatches } from "./check-claim-scope.mjs";

describe("classifySearchCorpus", () => {
  it("treats a search with no path operand as repo-wide", () => {
    // ripgrep and `git grep` default to the whole tree from cwd.
    expect(classifySearchCorpus('rg "mtimeMs"')).toBe("repo-wide");
    expect(classifySearchCorpus('git grep -n "mtime"')).toBe("repo-wide");
  });

  it("treats an explicit repo root as repo-wide", () => {
    expect(classifySearchCorpus('grep -rn "mtime" .')).toBe("repo-wide");
  });

  it("treats a git ls-files pipeline as repo-wide", () => {
    expect(classifySearchCorpus('git ls-files | xargs grep -ln "mtime"')).toBe("repo-wide");
  });

  it("treats a directory operand as scoped — the founding mistake", () => {
    expect(classifySearchCorpus('rg -l "mtimeMs" packages/cli/src/doctor/checks/')).toBe("scoped");
    expect(classifySearchCorpus('grep -rn "x" packages/')).toBe("scoped");
  });

  it("treats a single-file operand as scoped", () => {
    expect(
      classifySearchCorpus('grep -n "TsBuildInfo" node_modules/typescript/lib/typescript.d.ts'),
    ).toBe("scoped");
  });

  it("does not classify a non-search command", () => {
    expect(classifySearchCorpus("npm run build")).toBe("not-a-search");
    expect(classifySearchCorpus("node scripts/repo-census.mjs")).toBe("not-a-search");
  });

  it("is not fooled by a pattern that merely contains a slash", () => {
    // The PATTERN is not the corpus. `grep -r "a/b"` with no operand is still
    // repo-wide, and reading the quoted pattern as a path would call it scoped.
    expect(classifySearchCorpus('grep -r "packages/cli"')).toBe("repo-wide");
  });
});

describe("findScopeMismatches", () => {
  it("flags a universal negative backed by a scoped search", () => {
    const markdown = [
      "**Q2. Does anything already detect it?**",
      "No. Nothing in this repository reads a build timestamp.",
      "",
      "```",
      'rg -l "mtimeMs" packages/cli/src/doctor/checks/',
      "```",
    ].join("\n");
    const found = findScopeMismatches(markdown);
    expect(found).toHaveLength(1);
    expect(found[0].evidence).toContain("packages/cli/src/doctor/checks/");
    // The FIRST quantifier in the section, not the most emphatic. This block
    // carries two — the question and its answer — and anchoring at the top of
    // the claim is deterministic and points a reader where the claim starts.
    // The interrogative form is deliberately in the list: in this repository's
    // Q&A record style, "Does anything already detect it?" followed by "No."
    // IS the universal negative, and dropping question forms would have made
    // this check miss its own founding case a second time.
    expect(found[0].quantifier).toBe("does anything already");
  });

  it("accepts the same claim backed by a repo-wide search", () => {
    const markdown = [
      "Nothing in this repository reads a build timestamp.",
      "",
      "```",
      'git ls-files | xargs grep -ln "mtime"',
      "```",
    ].join("\n");
    expect(findScopeMismatches(markdown)).toEqual([]);
  });

  it("ignores a scoped search that makes no universal claim", () => {
    const markdown = [
      "The doctor registry holds fifteen checks.",
      "",
      "```",
      'rg -l "export" packages/cli/src/doctor/checks/',
      "```",
    ].join("\n");
    expect(findScopeMismatches(markdown)).toEqual([]);
  });

  it("does not pair a claim with a command an unrelated section away", () => {
    const markdown = [
      "Nothing in this repository reads a build timestamp.",
      "",
      "## An unrelated section",
      "",
      "```",
      'rg -l "x" packages/',
      "```",
    ].join("\n");
    expect(findScopeMismatches(markdown)).toEqual([]);
  });

  it("reports the line number so a reader can go and look", () => {
    const markdown = [
      "intro",
      "Nothing anywhere in the repo does this.",
      "",
      "```",
      'rg "x" docs/',
      "```",
    ].join("\n");
    const found = findScopeMismatches(markdown);
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(2);
  });
});

describe("findScopeMismatches — the founding mistake had no fenced command at all", () => {
  /**
   * ⚠️ THE TEST THIS CHECK FAILED FIRST. Q2's evidence was never a quoted
   * command. It was a directory named in inline code:
   *
   *   No. Measured: `packages/cli/src/doctor/checks/` holds 15 non-test check
   *   files and none reads a build timestamp.
   *
   * The first version of this file inspected only fenced blocks, so it passed
   * the exact text it was built to catch. A guard that cannot fail on its own
   * founding case is a claim about protection that does not exist — the same
   * standard applied to every candidate this design rejected.
   */
  it("flags a universal negative whose only cited evidence is a scoped path", () => {
    const markdown = [
      "**Q2. Does anything already detect it?**",
      "No. Measured: `packages/cli/src/doctor/checks/` holds 15 non-test check",
      "files and none reads a build timestamp.",
    ].join("\n");
    const found = findScopeMismatches(markdown);
    expect(found).toHaveLength(1);
    expect(found[0].evidence).toBe("packages/cli/src/doctor/checks/");
    expect(found[0].evidenceKind).toBe("path");
  });

  it("accepts the claim when a repo-wide command appears in the same section", () => {
    const markdown = [
      "No. Nothing in this repository reads a build timestamp; `packages/cli/src/doctor/checks/`",
      "holds 15 checks and none does.",
      "",
      "```",
      'git ls-files | xargs grep -ln "mtime"',
      "```",
    ].join("\n");
    expect(findScopeMismatches(markdown)).toEqual([]);
  });

  it("does not flag a scoped path cited without any universal claim", () => {
    const markdown = ["`packages/cli/src/doctor/checks/` holds 15 non-test check files."].join(
      "\n",
    );
    expect(findScopeMismatches(markdown)).toEqual([]);
  });

  it("does not treat a bare filename or a symbol as a scoped corpus", () => {
    // `checksum-drift.ts` names a FILE being discussed, not the corpus a claim
    // was searched over. Flagging it would fire on ordinary prose, and a lint
    // that cries wolf gets switched off.
    const markdown = [
      "Nothing in this repository reads a build timestamp — `checksum-drift.ts`",
      "and `verdictInForce` both compare digests.",
    ].join("\n");
    expect(findScopeMismatches(markdown)).toEqual([]);
  });
});

describe("proximity — evidence sits beside its claim, not anywhere in the section", () => {
  /**
   * ⚠️ MEASURED FALSE POSITIVES. The first run over `docs/evidence` reported 5
   * mismatches; 3 were wrong, and all 3 by the same mechanism — the claim was
   * paired with a scoped path far away in the same section, mentioned as a
   * SUBJECT rather than offered as a corpus. The worst was 125 lines away.
   *
   * A lint that cries wolf gets switched off, which protects nothing. Evidence
   * for a claim sits next to it in prose, so pairing is bounded to a paragraph's
   * worth of lines either side.
   */
  const near = (gap) =>
    [
      "Nothing in this repository reads a build timestamp.",
      ...Array.from({ length: gap }, () => "filler prose that mentions no location."),
      "Measured: `packages/cli/src/doctor/checks/` holds 15 checks.",
    ].join("\n");

  it("pairs a claim with evidence a few lines away", () => {
    expect(findScopeMismatches(near(2))).toHaveLength(1);
  });

  it("does NOT pair a claim with a path far away in the same section", () => {
    expect(findScopeMismatches(near(40))).toEqual([]);
  });

  it("pairs evidence that appears just BEFORE the claim", () => {
    const markdown = [
      "Measured: `packages/cli/src/doctor/checks/` holds 15 checks.",
      "Nothing in this repository reads a build timestamp.",
    ].join("\n");
    expect(findScopeMismatches(markdown)).toHaveLength(1);
  });
});
