/**
 * Unit tests for the marketplace-pin-digest classifier.
 *
 * WHAT IS BEING PINNED, AND WHY IT IS A TRIPWIRE RATHER THAN A FIX.
 * `packages/plugin/.claude-plugin/marketplace.json` carries a `version`, a
 * `commit` and a content `digest`. Only the digest is kept fresh per push
 * (`packages/plugin/src/marketplace-schema.test.ts:140-143`); `version` and
 * `commit` move only at a release cut. So between cuts the entry describes
 * HEAD's plugin content while naming the PREVIOUS release's commit. That
 * residual is knowingly accepted — no production code reads the recorded
 * digest, and every published tarball is built at its own tag — and
 * `docs/verification-playbook.md:321-325` is explicit about what to do with a
 * knowingly-accepted residual: "encode it in a test so it cannot change
 * silently. A residual named only in prose drifts."
 *
 * Hence two LEGAL states that pass and four named states that fail. The
 * `ahead-of-pin` arm passes LOUDLY, on every push, instead of surfacing once
 * per release inside `e2e/release`'s `marketplacePinCheck` — which is not a
 * `vitest.config.ts` project and therefore runs in no per-push channel at all.
 *
 * ⚠️ WHAT THIS SUITE MUST NOT BE MISTAKEN FOR. It does not replace
 * `marketplace-schema.test.ts`'s freshness assertion. That assertion is the
 * cited bearer of merged `phase-10.json` criterion 6, which calls it "the
 * load-bearing half of the digest clause" and records that it "demonstrably
 * bites". This suite's `stale-digest` arm OVERLAPS it, and
 * `docs/verification-playbook.md:610-628` records what that overlap does if
 * left unmeasured: coverage migrates between two checks and the older one
 * becomes enforced by comments alone. The overlap was therefore probed —
 * delete the freshness assertion and see what still reddens — and the result is
 * recorded in `docs/evidence/phase-10/marketplace-pin-digest-states.txt`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeContentDigest as tsComputeContentDigest,
  listPackagedFiles as tsListPackagedFiles,
} from "@crabgic/plugin";
import {
  classifyMarketplacePinDigest,
  computeContentDigest,
  extractPluginTreeAt,
  inspectMarketplacePinDigest,
  inspectPluginEntry,
  isAncestor,
  LEGAL_STATES,
  listPackagedFiles,
  MARKETPLACE_RELATIVE_PATH,
  PLUGIN_RELATIVE_PATH,
  resolveCommit,
  runMarketplacePinDigestCheck,
} from "./check-marketplace-pin-digest.mjs";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLUGIN_ROOT = path.join(REPO_ROOT, ...PLUGIN_RELATIVE_PATH.split("/"));

/**
 * The five commits this suite classifies. Named once so the shallow-clone guard
 * below and the historical-corpus assertion cannot drift apart.
 */
const CORPUS_COMMITS = ["cb450e3", "1c85913", "b5a609c", "2ff3bce", "6b9dd7b"];

/** A 40-hex string that is deliberately NOT a git object — see the assertion that proves it. */
const NOT_AN_OBJECT = "dead".repeat(10);

const cleanups = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (cleanups.length > 0) cleanups.pop()();
});

function facts(overrides) {
  return {
    commit: "1c85913e65f05a4d12c750dd2d3c2162d70834c5",
    recordedDigest: "aaaa",
    worktreeDigest: "aaaa",
    pinnedTreeDigest: "aaaa",
    commitResolves: true,
    pinIsAncestor: true,
    ...overrides,
  };
}

describe("classifyMarketplacePinDigest — the two legal states", () => {
  it("at-release: recorded === worktree === tree@pin", () => {
    const r = classifyMarketplacePinDigest(facts());
    expect(r.state).toBe("at-release");
    expect(r.ok).toBe(true);
  });

  it("ahead-of-pin: recorded === worktree, tree@pin differs, pin is an ancestor", () => {
    const r = classifyMarketplacePinDigest(facts({ pinnedTreeDigest: "bbbb" }));
    expect(r.state).toBe("ahead-of-pin");
    expect(r.ok).toBe(true);
    // The message must SAY which way round the drift goes. A residual whose
    // announcement does not name the direction is not an announcement.
    expect(r.message).toContain("describes HEAD's plugin content");
  });

  it("declares exactly those two as legal, so a third cannot be added silently", () => {
    expect([...LEGAL_STATES]).toEqual(["at-release", "ahead-of-pin"]);
  });
});

describe("classifyMarketplacePinDigest — the three FAIL fixtures", () => {
  it("stale-digest: a hand-edited digest that describes no tree", () => {
    const r = classifyMarketplacePinDigest(
      facts({ recordedDigest: "handedited", worktreeDigest: "aaaa" }),
    );
    expect(r.state).toBe("stale-digest");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("hand-edited");
  });

  it("unresolvable-pin: a 40-hex commit that resolves to nothing", () => {
    const r = classifyMarketplacePinDigest(
      facts({ commit: NOT_AN_OBJECT, commitResolves: false, pinnedTreeDigest: undefined }),
    );
    expect(r.state).toBe("unresolvable-pin");
    expect(r.ok).toBe(false);
    expect(r.message).toContain(NOT_AN_OBJECT);
  });

  it("non-ancestor-pin: a real commit that HEAD cannot reach", () => {
    const r = classifyMarketplacePinDigest(
      facts({ pinIsAncestor: false, pinnedTreeDigest: undefined }),
    );
    expect(r.state).toBe("non-ancestor-pin");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("not an ancestor of HEAD");
  });

  it("checks resolvability BEFORE freshness, so an unresolvable pin is not reported as a stale digest", () => {
    // Ordering is behaviour, not taste: with the opposite order an
    // unresolvable pin on a tree whose digest is also stale would be reported
    // as the wrong defect, and the operator would go and edit the digest.
    const r = classifyMarketplacePinDigest(
      facts({ commitResolves: false, recordedDigest: "x", worktreeDigest: "y" }),
    );
    expect(r.state).toBe("unresolvable-pin");
  });
});

describe("the checkout carries the history this suite measures against", () => {
  it("has the five corpus commits — fails HERE, naming the cause, rather than cascading", () => {
    // MEASURED ON PR #131, and this test is the remedy. `actions/checkout`'s
    // default is a depth-1 shallow clone, under which every commit below is
    // `fatal: not a valid object name`. The suite was green locally (a
    // developer's clone has the history) and went 7-failed on BOTH
    // `ubuntu-latest` and `ubuntu-24.04-arm`, as a scatter of unrelated-looking
    // assertion errors that said nothing about the real cause.
    //
    // `ci.yml`'s `test` job now sets `fetch-depth: 0`. This assertion is what
    // makes a future revert of that setting fail with ONE message that names
    // it, instead of seven that do not.
    //
    // Deliberately NOT a skip. A suite that early-returns on a missing
    // prerequisite reports a green tick having asserted nothing — the exact
    // defect class `ci.yml`'s own bubblewrap guard was rewritten to avoid.
    const missing = CORPUS_COMMITS.filter((rev) => resolveCommit(REPO_ROOT, rev) === undefined);
    expect(
      missing,
      "shallow clone: set `fetch-depth: 0` on this job's actions/checkout step",
    ).toEqual([]);
  });
});

describe("the git facts are real, not assumed", () => {
  it("resolves a real commit and refuses a 40-hex string that is not an object", () => {
    // The control for the `unresolvable-pin` fixture above: without it, that
    // fixture asserts a hand-written boolean rather than anything git says.
    expect(resolveCommit(REPO_ROOT, "cb450e3")).toBe("cb450e3ef11610e2cd5d18ccf7da6cb7a3a65442");
    expect(resolveCommit(REPO_ROOT, NOT_AN_OBJECT)).toBeUndefined();
  });

  it("reports ancestry in the direction it claims, and refuses the reverse", () => {
    const older = "6b9dd7b";
    const newer = "cb450e3";
    expect(isAncestor(REPO_ROOT, older, newer)).toBe(true);
    // The reverse probe. An `isAncestor` that always returned true would pass
    // the line above.
    expect(isAncestor(REPO_ROOT, newer, older)).toBe(false);
  });
});

describe("the transcribed digest agrees with `@crabgic/plugin`'s own", () => {
  it("reproduces `computeContentDigest` exactly on the real plugin tree", () => {
    // The binding for the transcription. This module reimplements
    // `packages/plugin/src/content-digest.ts` because `meta-checks` runs on
    // `npm ci` with no build, so `@crabgic/plugin` is not importable there. A
    // reimplementation nobody compares to its source is a belief.
    expect(computeContentDigest(PLUGIN_ROOT)).toBe(tsComputeContentDigest(PLUGIN_ROOT));
  });

  it("that digest is the one the committed entry records (rules out two agreeing wrongs)", () => {
    // Two implementations agreeing proves they are the same function, not that
    // either is the RIGHT one. The committed entry is the third witness.
    const marketplace = JSON.parse(
      readFileSync(path.join(REPO_ROOT, ...MARKETPLACE_RELATIVE_PATH.split("/")), "utf8"),
    );
    expect(computeContentDigest(PLUGIN_ROOT)).toBe(marketplace.plugins[0].digest);
  });

  it("walks the same packaged file set, file for file, over a real non-empty tree", () => {
    // Without this, a `listPackagedFiles` returning nothing makes both
    // assertions above agree on the sha256 of the empty input — two
    // implementations can agree perfectly by both doing nothing.
    const files = listPackagedFiles(PLUGIN_ROOT);
    expect(files).toEqual([...tsListPackagedFiles(PLUGIN_ROOT)]);
    expect(files.length).toBeGreaterThan(10); // 18 at cb450e3; a floor, not a pin.
    expect(files.some((f) => f.startsWith("agents/"))).toBe(true);
    // The exclusions are load-bearing: `.claude-plugin/` holds the file that
    // CITES the digest, so including it would make the digest self-referential.
    expect(files.some((f) => f.startsWith(".claude-plugin/"))).toBe(false);
    expect(files.some((f) => f.startsWith("src/") || f.startsWith("dist/"))).toBe(false);
  });
});

describe("the real repository is in one of the two legal states", () => {
  it("classifies THIS worktree, and it is legal", () => {
    // THE PER-PUSH BEARER. Not a fixture: this reads the committed entry, walks
    // the real plugin tree, and `git archive`s the pinned commit.
    const result = inspectMarketplacePinDigest(REPO_ROOT, "HEAD");
    expect(LEGAL_STATES).toContain(result.state);
    expect(result.ok).toBe(true);
    expect(result.recordedDigest).toBe(result.worktreeDigest);
    // The `tree@pin` digest was ACTUALLY COMPUTED, not left undefined.
    //
    // Added after the mutation battery showed the historical corpus was the
    // ONLY thing pinning that computation: deleting it left this arm green,
    // because a missing `tree@pin` reports `ahead-of-pin`, which is legal. This
    // assertion pins it with NO history dependency beyond the entry's own
    // commit — and it is a second signal for the shallow-clone breakage below,
    // which the corpus test caught only because it names five older commits.
    expect(result.pinnedTreeDigest).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);
});

describe("the reporting channel actually speaks", () => {
  it("prints the ahead-of-pin drift rather than passing silently", () => {
    // `docs/verification-playbook.md:811-819`: a channel's SILENCE evidences
    // nothing until you have watched it speak for a value you know is
    // interesting. `b5a609c` is a real `ahead-of-pin` commit — PR #118's drift —
    // so this drives a KNOWN drifted state through the real reporting path and
    // reads the line back.
    const exported = extractPluginTreeAt(REPO_ROOT, "b5a609c");
    cleanups.push(exported.cleanup);
    const marketplace = JSON.parse(
      readFileSync(path.join(exported.pluginRoot, ".claude-plugin", "marketplace.json"), "utf8"),
    );
    const result = inspectPluginEntry({
      repoRoot: REPO_ROOT,
      headRev: "b5a609c",
      entry: marketplace.plugins[0],
      pluginRoot: exported.pluginRoot,
    });
    expect(result.state).toBe("ahead-of-pin");
    expect(result.version).toBe("1.5.0");
    expect(result.recordedDigest).toBe(result.worktreeDigest);
    expect(result.pinnedTreeDigest).not.toBe(result.worktreeDigest);

    // ...and the CLI layer renders it, on stdout, non-blocking.
    const lines = [];
    vi.spyOn(console, "log").mockImplementation((m) => lines.push(String(m)));
    const errors = [];
    vi.spyOn(console, "error").mockImplementation((m) => errors.push(String(m)));
    const exit = runMarketplacePinDigestCheck(REPO_ROOT, "HEAD");
    expect(exit).toBe(0);
    expect(errors).toEqual([]);
    expect(lines.join("\n")).toContain("check-marketplace-pin-digest:");
  }, 60_000);

  it("renders a FAIL to stderr with a non-zero exit", () => {
    // The opposite direction, so "prints something on stdout" is not satisfied
    // by a check that can only ever pass. Driven through the real CLI by
    // pointing it at a HEAD the committed pin cannot reach.
    const errors = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation((m) => errors.push(String(m)));
    const exit = runMarketplacePinDigestCheck(REPO_ROOT, "6b9dd7b");
    expect(exit).toBe(1);
    expect(errors.join("\n")).toContain("FAIL — non-ancestor-pin");
  }, 60_000);
});

describe("the historical corpus this classifier was built from", () => {
  it("reproduces all five measured commits, using the real classifier", () => {
    // RED-FIRST, HISTORICAL RATHER THAN SYNTHETIC — the strongest form
    // available, because the drift really happened twice and is recoverable
    // from git. Each row exports that commit's own `packages/plugin` and
    // classifies it with the production classifier.
    const expected = [
      { rev: "cb450e3", version: "1.6.0", state: "at-release" },
      { rev: "1c85913", version: "1.6.0", state: "ahead-of-pin" },
      { rev: "b5a609c", version: "1.5.0", state: "ahead-of-pin" }, // PR #118 drift
      { rev: "2ff3bce", version: "1.5.0", state: "ahead-of-pin" }, // PR #50 drift
      { rev: "6b9dd7b", version: "1.5.0", state: "at-release" }, // the v1.5.0 tag
    ];
    // Bound to the shallow-clone guard's list, so the two cannot drift.
    expect(expected.map((e) => e.rev)).toEqual(CORPUS_COMMITS);
    const actual = expected.map(({ rev }) => {
      const exported = extractPluginTreeAt(REPO_ROOT, rev);
      cleanups.push(exported.cleanup);
      const marketplace = JSON.parse(
        readFileSync(path.join(exported.pluginRoot, ".claude-plugin", "marketplace.json"), "utf8"),
      );
      const r = inspectPluginEntry({
        repoRoot: REPO_ROOT,
        headRev: rev,
        entry: marketplace.plugins[0],
        pluginRoot: exported.pluginRoot,
      });
      return { rev, version: r.version, state: r.state };
    });
    expect(actual).toEqual(expected);

    // The corpus must contain BOTH states, or "always at-release" and "always
    // ahead-of-pin" would each satisfy the equality above.
    expect(new Set(actual.map((r) => r.state))).toEqual(new Set(LEGAL_STATES));
  }, 180_000);
});

describe("repo wiring", () => {
  it("is reachable as `npm run check:marketplace-pin` and chained into check:all", () => {
    const root = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    expect(root.scripts["check:marketplace-pin"]).toBe(
      "node scripts/check-marketplace-pin-digest.mjs",
    );
    expect(root.scripts["check:all"]).toContain("check:marketplace-pin");
  });

  it("runs as a `meta-checks` step in ci.yml — the per-push channel it claims", () => {
    // `docs/verification-playbook.md:106-108`: a lane outside the default
    // fan-out is unrun evidence. This pins the wiring so the claim in this
    // file's header cannot quietly stop being true.
    const workflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(workflow).toContain("npm run check:marketplace-pin");
  });

  it("does not shell out to `git config` or `git worktree` anywhere", () => {
    // Hard rules 2 and 3 of `docs/verification-playbook.md`. Asserted rather
    // than promised, because this is the one script here that runs git at all.
    const source = readFileSync(
      path.join(REPO_ROOT, "scripts/check-marketplace-pin-digest.mjs"),
      "utf8",
    );
    for (const forbidden of ['"config"', '"worktree"']) {
      expect(source).not.toContain(forbidden);
    }
  });
});

describe("the temp export leaves nothing behind", () => {
  it("removes its scratch directory on cleanup", () => {
    const before = mkdtempSync(path.join(tmpdir(), "probe-"));
    rmSync(before, { recursive: true, force: true });
    const exported = extractPluginTreeAt(REPO_ROOT, "cb450e3");
    const dir = path.dirname(path.dirname(exported.pluginRoot));
    expect(execFileSync("test", ["-d", dir]) === undefined || true).toBe(true);
    exported.cleanup();
    expect(() => execFileSync("test", ["-d", dir])).toThrow();
  }, 60_000);
});
