import { describe, expect, it } from "vitest";
import { matchesAnchoredGlobLiteral, matchesToolPathRule } from "./path-matching.js";

/**
 * Anchor forms (`//`, `~/`, bare `/`) mirror `@eo/engine-core`'s own
 * compiled-profile literals (`Edit(//<path>/**)`, `Read(~/.ssh/**)`).
 * Path-escape coverage (`../`, absolute) — roadmap/03 work item 6's
 * fixture list.
 */
describe("matchesAnchoredGlobLiteral", () => {
  it("matches a plain (worktree-relative, '//'-anchor-equivalent) target under the base", () => {
    expect(
      matchesAnchoredGlobLiteral("//packages/example/src/**", "packages/example/src/foo.ts"),
    ).toBe(true);
  });

  it("matches the base path itself with no trailing segment", () => {
    expect(matchesAnchoredGlobLiteral("//packages/example/src/**", "packages/example/src")).toBe(
      true,
    );
  });

  it("does not match a sibling path with a shared prefix substring", () => {
    expect(
      matchesAnchoredGlobLiteral("//packages/example/src/**", "packages/example/src-evil/foo.ts"),
    ).toBe(false);
  });

  it("does not match a relative traversal that escapes the base (path-escape fixture)", () => {
    expect(
      matchesAnchoredGlobLiteral(
        "//packages/example/src/**",
        "packages/example/src/../../../etc/passwd",
      ),
    ).toBe(false);
  });

  it("does not match an absolute target against a '//'-anchored (worktree-relative) rule (path-escape fixture)", () => {
    expect(matchesAnchoredGlobLiteral("//packages/example/src/**", "/etc/passwd")).toBe(false);
  });

  it("matches a '~/'-anchored rule against a '~/'-prefixed target", () => {
    expect(matchesAnchoredGlobLiteral("~/.ssh/**", "~/.ssh/id_rsa")).toBe(true);
  });

  it("does not match a '~/'-anchored rule against an unrelated absolute target", () => {
    expect(matchesAnchoredGlobLiteral("~/.ssh/**", "/etc/passwd")).toBe(false);
  });

  it("matches a bare '/'-anchored rule against a matching absolute target", () => {
    expect(matchesAnchoredGlobLiteral("/etc/allowed/**", "/etc/allowed/file.txt")).toBe(true);
  });
});

describe("matchesAnchoredGlobLiteral — worktree-placeholder resolution (phase-03 security-fix round, CRITICAL 1 follow-through)", () => {
  it("resolves the compiler's '//<worktree>/...' owned-path allow form against a bare worktree-relative target", () => {
    expect(
      matchesAnchoredGlobLiteral(
        "//<worktree>/packages/example/src/**",
        "packages/example/src/foo.ts",
      ),
    ).toBe(true);
  });

  it("still denies a traversal escape under the worktree-placeholder-resolved rule", () => {
    expect(
      matchesAnchoredGlobLiteral(
        "//<worktree>/packages/example/src/**",
        "packages/example/src/../../../etc/passwd",
      ),
    ).toBe(false);
  });

  it("a raw, unanchored '//'-literal that does NOT carry the worktree placeholder (e.g. a hypothetical unvalidated escape) does not spuriously match a plain worktree-relative target with a different name", () => {
    expect(matchesAnchoredGlobLiteral("//etc/cron.d/**", "packages/example/src/foo.ts")).toBe(
      false,
    );
  });
});

describe("matchesAnchoredGlobLiteral — F5 cross-anchor hardening (NOTE 5, known fake-fidelity limitation)", () => {
  it("a bare-absolute-spelled read under a sensitive suffix IS still caught by the '~/'-anchored deny (widening, over-blocking only)", () => {
    expect(matchesAnchoredGlobLiteral("~/.ssh/**", "/home/user/.ssh/id_rsa")).toBe(true);
  });

  it("a bare-absolute-spelled read NOT under any sensitive suffix is unaffected (no false-widening)", () => {
    expect(matchesAnchoredGlobLiteral("~/.ssh/**", "/home/user/projects/readme.md")).toBe(false);
  });

  it("known limitation: this is a lexical, case-sensitive segment search, not a real home-directory resolution — a differently-cased absolute spelling of the same real file (e.g. a case-insensitive host filesystem) is NOT caught, an under-match (false-DENY-omission), never a false-ALLOW of a rule that would otherwise have matched", () => {
    // On a case-insensitive filesystem, "/Home/User/.SSH/id_rsa" could be
    // the literal same file as ~/.ssh/id_rsa. This fake performs no
    // filesystem-aware case-folding — it simply fails to widen the match
    // here, which is strictly safer than the alternative (never produces a
    // false-ALLOW), but is a real fidelity gap phase 06's @live suite must
    // independently confirm does not matter on the real engine.
    expect(matchesAnchoredGlobLiteral("~/.ssh/**", "/Home/User/.SSH/id_rsa")).toBe(false);
  });
});

describe("matchesToolPathRule", () => {
  it("matches when both the tool and the anchored glob agree", () => {
    expect(
      matchesToolPathRule("Edit(//packages/example/src/**)", "Edit", "packages/example/src/foo.ts"),
    ).toBe(true);
  });

  it("does not match when the tool differs (Edit rule vs Write call)", () => {
    expect(
      matchesToolPathRule(
        "Edit(//packages/example/src/**)",
        "Write",
        "packages/example/src/foo.ts",
      ),
    ).toBe(false);
  });

  it("does not match a non-path rule string (e.g. a Bash rule)", () => {
    expect(matchesToolPathRule("Bash(npm run test:*)", "Edit", "packages/example/src/foo.ts")).toBe(
      false,
    );
  });

  it("Read(~/.ssh/**) matches an attempted read under ~/.ssh (docs/engine-baseline.md §6 denyRead probe)", () => {
    expect(matchesToolPathRule("Read(~/.ssh/**)", "Read", "~/.ssh/config")).toBe(true);
  });
});
