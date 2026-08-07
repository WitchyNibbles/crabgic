#!/usr/bin/env node
// Classifies the committed marketplace entry into one of two LEGAL states and
// fails on everything else. Run with:
//   node scripts/check-marketplace-pin-digest.mjs
//
// WHY THIS EXISTS (2026-08-07). `packages/plugin/.claude-plugin/marketplace.json`
// carries three coupled facts about the plugin: a `version`, a `commit`, and a
// content `digest`. Only one of them is kept fresh per push —
// `packages/plugin/src/marketplace-schema.test.ts:140-143` requires `digest` to
// equal a fresh recomputation from the on-disk plugin, so any PR touching a
// packaged plugin file must rewrite it in the same commit. `version` and
// `commit` move only at a release cut. Between cuts the entry therefore
// describes HEAD's content while naming the PREVIOUS release's commit and
// version.
//
// Measured, five commits, via `git archive` of each (see
// `docs/evidence/phase-10/marketplace-pin-digest-states.txt`):
//
//   cb450e3  entry 1.6.0        recorded fa13c22c223a  digest(tree@pin) fa13c22c223a  at-release
//   1c85913  entry 1.6.0        recorded fa13c22c223a  digest(tree@pin) d3b18ed68c91  ahead-of-pin
//   b5a609c  entry 1.5.0        recorded fa13c22c223a  digest(tree@pin) d3b18ed68c91  ahead-of-pin
//   2ff3bce  entry 1.5.0        recorded 983414f02e44  digest(tree@pin) d3b18ed68c91  ahead-of-pin
//   6b9dd7b  entry 1.5.0 (tag)  recorded d3b18ed68c91  digest(tree@pin) d3b18ed68c91  at-release
//
// `recorded === digest(worktree)` at all five: the per-push freshness test has
// never been violated. The drift is entirely `recorded` vs `digest(tree@pin)`,
// and NOTHING per-push said a word about it — it surfaced once per release, in
// `e2e/release`'s `marketplacePinCheck`, which runs in no per-push channel
// (`e2e/release` is not a `vitest.config.ts` project).
//
// WHAT AN OPERATOR EXPERIENCES: nothing. Measured on both published tarballs —
// every published release is a self-consistent (version, commit, digest)
// triple, because the tarball is built at the tag. And the recorded `digest`
// has no production reader at all: `install.ts`, `upgrade.ts` and
// `capability-manifest-freshness.ts` each RECOMPUTE from the plugin source
// directory and never read this field.
//
// So this check does not fix a bug. It does what
// `docs/verification-playbook.md:321-325` asks for a deliberately-open gap:
// "encode it in a test so it cannot change silently. A residual named only in
// prose drifts." `ahead-of-pin` is knowingly accepted and PASSES — loudly, on
// every push. The third state, which nothing named before, blocks.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const PLUGIN_RELATIVE_PATH = "packages/plugin";
export const MARKETPLACE_RELATIVE_PATH = "packages/plugin/.claude-plugin/marketplace.json";

// ---------------------------------------------------------------------------
// THE DIGEST, TRANSCRIBED FROM `packages/plugin/src/content-digest.ts`.
//
// Transcribed and not imported, for one measured reason: this check runs in the
// `meta-checks` job, which does `npm ci` and NEVER `npm run build`
// (`.github/workflows/ci.yml`'s own comment says the validators there are
// dependency-free "precisely because this job does not build"). `@crabgic/plugin`
// resolves through `packages/plugin/dist/`, which does not exist in that job.
//
// A transcription nobody compares to its source is a belief, so
// `check-marketplace-pin-digest.test.mjs` binds the two: it asserts this
// function reproduces the digest the TypeScript module's own committed output
// records for the real plugin tree, and separately that the two implementations
// agree file-for-file on the packaged file list.
//
// `content-digest.ts:21-27` is pinned by a merged citation and must not be
// edited; that is why this behaviour lives here rather than there.
// ---------------------------------------------------------------------------

/** `content-digest.ts:21-28`'s `EXCLUDED_ENTRIES`, verbatim. */
export const EXCLUDED_ENTRIES = new Set([
  "src",
  "dist",
  "node_modules",
  "package.json",
  "tsconfig.json",
  ".claude-plugin",
]);

function normalizeForDigest(content) {
  return content.replace(/\r\n/g, "\n");
}

/** `content-digest.ts:35-52`'s `listPackagedFiles`, transcribed. */
export function listPackagedFiles(pluginRoot) {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      const relPath = path.relative(pluginRoot, entryPath);
      const topLevel = relPath.split(path.sep)[0];
      if (EXCLUDED_ENTRIES.has(topLevel)) continue;
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile()) {
        files.push(relPath.split(path.sep).join("/"));
      }
    }
  }
  if (statSync(pluginRoot).isDirectory()) walk(pluginRoot);
  return files.sort();
}

/** `content-digest.ts:60-70`'s `computeContentDigest`, transcribed. */
export function computeContentDigest(pluginRoot) {
  const hash = createHash("sha256");
  for (const relPath of listPackagedFiles(pluginRoot)) {
    const content = readFileSync(path.join(pluginRoot, ...relPath.split("/")), "utf8");
    hash.update(relPath);
    hash.update("\0");
    hash.update(normalizeForDigest(content));
    hash.update("\0");
  }
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// GIT — read-only. NEVER `git config` and NEVER `git worktree`
// (`docs/verification-playbook.md:20-23`): worktrees share `.git/config`, and a
// worktree created inside the repo has broken `npm run lint` repo-wide before.
// `git archive` into a temp dir outside the repo touches neither.
// ---------------------------------------------------------------------------

/**
 * `process.env` with every `GIT_*` name dropped. `cwd` does NOT decide which
 * repository git operates on — `GIT_DIR`/`GIT_WORK_TREE` win, and git exports
 * them into every hook it runs, including a pre-push hook that could invoke
 * this check. Same rationale, and the same three real corruptions, as
 * `scripts/check-repo-hygiene.mjs`'s `scrubbedGitEnv`.
 */
function scrubbedGitEnv() {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || name.startsWith("GIT_")) continue;
    env[name] = value;
  }
  return env;
}

function git(repoRoot, args, options = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    env: scrubbedGitEnv(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

/** The full object id `rev` names, or `undefined` when it resolves to no commit in this repository. */
export function resolveCommit(repoRoot, rev) {
  try {
    return git(repoRoot, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], {
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/** Whether `ancestor` is reachable from `descendant`. */
export function isAncestor(repoRoot, ancestor, descendant) {
  try {
    git(repoRoot, ["merge-base", "--is-ancestor", ancestor, descendant], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Exports `packages/plugin` as it stood at `commit` into a fresh temp directory
 * OUTSIDE the repository, and returns the plugin root inside it plus a
 * `cleanup()`.
 */
export function extractPluginTreeAt(repoRoot, commit) {
  const dir = mkdtempSync(path.join(tmpdir(), "crabgic-pin-digest-"));
  const tarPath = path.join(dir, "plugin.tar");
  git(repoRoot, ["archive", "--format=tar", "-o", tarPath, commit, PLUGIN_RELATIVE_PATH]);
  execFileSync("tar", ["-xf", tarPath, "-C", dir], { stdio: ["ignore", "ignore", "pipe"] });
  return {
    pluginRoot: path.join(dir, ...PLUGIN_RELATIVE_PATH.split("/")),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// THE CLASSIFIER — pure, so every arm is unit-testable without a git repository.
// ---------------------------------------------------------------------------

/**
 * The two states this repository accepts, and the four it does not.
 *
 * `at-release`   — recorded digest === worktree digest === digest of the tree at
 *                  the pinned commit. The entry describes a real released
 *                  triple. PASS, quiet.
 * `ahead-of-pin` — recorded digest === worktree digest, but the tree at the
 *                  pinned commit hashes differently, and the pin is an ancestor
 *                  of HEAD. The entry describes HEAD's content under the
 *                  previous release's commit and version. PASS, and PRINTS on
 *                  every push. Knowingly accepted; see
 *                  `docs/evidence/criteria-closeout/defects/
 *                  10-marketplace-entry-ahead-of-its-own-pin.md`.
 *
 * Everything else FAILS, and each failure is named rather than collapsed:
 * `stale-digest` (the recorded digest does not describe the worktree — a
 * hand-edit, or a packaged file changed without the freshness test being run),
 * `unresolvable-pin` (the `commit` names nothing in this repository) and
 * `non-ancestor-pin` (it names a commit not reachable from HEAD — a pin from a
 * rewritten or foreign history).
 */
export const LEGAL_STATES = Object.freeze(["at-release", "ahead-of-pin"]);

export function classifyMarketplacePinDigest(facts) {
  const {
    recordedDigest,
    worktreeDigest,
    pinnedTreeDigest,
    commit,
    commitResolves,
    pinIsAncestor,
  } = facts;

  if (!commitResolves) {
    return {
      state: "unresolvable-pin",
      ok: false,
      message:
        `the entry pins commit ${commit}, which resolves to no commit in this repository — ` +
        "the digest it should be compared against cannot be computed at all.",
    };
  }
  if (!pinIsAncestor) {
    return {
      state: "non-ancestor-pin",
      ok: false,
      message:
        `the entry pins commit ${commit}, which is not an ancestor of HEAD — the entry describes ` +
        "a history this branch does not contain.",
    };
  }
  if (recordedDigest !== worktreeDigest) {
    return {
      state: "stale-digest",
      ok: false,
      message:
        `the recorded digest ${recordedDigest} does not describe the plugin tree in this ` +
        `worktree (${worktreeDigest}) — the entry has been hand-edited, or a packaged plugin ` +
        "file changed without the digest being refreshed.",
    };
  }
  if (worktreeDigest === pinnedTreeDigest) {
    return {
      state: "at-release",
      ok: true,
      message:
        `the entry's digest ${recordedDigest} describes both this worktree and the tree at its ` +
        `own pinned commit ${commit} — a self-consistent released triple.`,
    };
  }
  return {
    state: "ahead-of-pin",
    ok: true,
    message:
      `the entry's digest ${recordedDigest} describes THIS worktree, but the tree at its pinned ` +
      `commit ${commit} hashes ${pinnedTreeDigest}. The entry therefore describes HEAD's plugin ` +
      "content while naming the previous release's commit and version. Knowingly accepted: no " +
      "production code reads the recorded digest, and every published tarball is built at its " +
      "own tag, so this never reaches an npm consumer. It resolves at the next release cut.",
  };
}

/** Gathers the facts the classifier needs from a real repository, then classifies. */
export function inspectMarketplacePinDigest(repoRoot = REPO_ROOT, headRev = "HEAD") {
  const marketplace = JSON.parse(
    readFileSync(path.join(repoRoot, ...MARKETPLACE_RELATIVE_PATH.split("/")), "utf8"),
  );
  const entry = marketplace.plugins?.[0];
  if (entry === undefined) {
    throw new Error(`check-marketplace-pin-digest: ${MARKETPLACE_RELATIVE_PATH} lists no plugin.`);
  }
  return inspectPluginEntry({
    repoRoot,
    headRev,
    entry,
    pluginRoot: path.join(repoRoot, ...PLUGIN_RELATIVE_PATH.split("/")),
  });
}

/**
 * The seam the historical replay uses: `pluginRoot` and `entry` are supplied,
 * so a past commit's exported tree can be classified with THIS classifier
 * rather than a reimplementation of it.
 */
export function inspectPluginEntry({ repoRoot, headRev, entry, pluginRoot }) {
  const worktreeDigest = computeContentDigest(pluginRoot);
  const resolved = resolveCommit(repoRoot, entry.commit);
  const commitResolves = resolved !== undefined;
  const pinIsAncestor = commitResolves && isAncestor(repoRoot, resolved, headRev);

  let pinnedTreeDigest;
  if (commitResolves && pinIsAncestor) {
    const exported = extractPluginTreeAt(repoRoot, resolved);
    try {
      pinnedTreeDigest = computeContentDigest(exported.pluginRoot);
    } finally {
      exported.cleanup();
    }
  }

  const facts = {
    version: entry.version,
    commit: entry.commit,
    recordedDigest: entry.digest,
    worktreeDigest,
    pinnedTreeDigest,
    commitResolves,
    pinIsAncestor,
  };
  return { ...facts, ...classifyMarketplacePinDigest(facts) };
}

const SHORT = (digest) => (typeof digest === "string" ? digest.slice(0, 12) : "—");

export function runMarketplacePinDigestCheck(repoRoot = REPO_ROOT, headRev = "HEAD") {
  const result = inspectMarketplacePinDigest(repoRoot, headRev);
  const summary =
    `entry version ${result.version}, pinned commit ${result.commit.slice(0, 12)}, ` +
    `recorded ${SHORT(result.recordedDigest)}, worktree ${SHORT(result.worktreeDigest)}, ` +
    `tree@pin ${SHORT(result.pinnedTreeDigest)}`;

  if (!result.ok) {
    console.error(`check-marketplace-pin-digest: FAIL — ${result.state}`);
    console.error(`  ${summary}`);
    console.error(`  ${result.message}`);
    return 1;
  }
  if (result.state === "ahead-of-pin") {
    // DELIBERATELY LOUD AND DELIBERATELY NON-BLOCKING. The whole point of this
    // arm is that the residual announces itself on every push instead of
    // surfacing once per release in a gate nothing runs before a tag.
    console.log(`check-marketplace-pin-digest: PASS — ahead-of-pin (accepted residual)`);
    console.log(`  ${summary}`);
    console.log(`  ${result.message}`);
    return 0;
  }
  console.log(`check-marketplace-pin-digest: PASS — at-release`);
  console.log(`  ${summary}`);
  return 0;
}

/* c8 ignore start — entry point; the exported functions above are what the suite drives. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runMarketplacePinDigestCheck());
}
/* c8 ignore stop */
