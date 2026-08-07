# Defect 10-marketplace-entry-ahead-of-its-own-pin

**Phase:** 10 — Plugin and installer (`roadmap/10-plugin-and-installer.md`, exit criterion 6 — the
digest clause of §In scope, "Distribution")

**Found:** 2026-08-07, post-v1.6.0 pass, at `cb450e3ef11610e2cd5d18ccf7da6cb7a3a65442`
(`origin/main`, tag `v1.6.0`).

**Severity:** knowingly-accepted residual. **No operator impact on any distribution channel that
exists**, measured on both published tarballs rather than argued (see "Blast radius" below). The
defect is that the residual was **unnamed and unasserted**: it lived in prose on a roadmap line and
in nothing executable, and it recurred twice without anything saying so between release cuts.

**Effort: S, and it is done** — one new dependency-free check plus its suite, wired as a
`meta-checks` step. Recorded here so the accepted half stays visible; the remedy for the residual
itself is a release-cut action, not a code change.

## What the entry couples, and what keeps each half honest

`packages/plugin/.claude-plugin/marketplace.json`'s single plugin entry carries three facts about the
same artifact:

| field     | who keeps it fresh                                                     | cadence        |
| --------- | ---------------------------------------------------------------------- | -------------- |
| `digest`  | `packages/plugin/src/marketplace-schema.test.ts`'s freshness assertion | **every push** |
| `version` | the release-cut process                                                | per release    |
| `commit`  | the release-cut process                                                | per release    |

The freshness assertion requires the recorded digest to equal a fresh recomputation from the plugin's
own on-disk files, so **any** PR touching a packaged plugin file must rewrite the digest in the same
commit. `version` and `commit` do not move until a cut.

⇒ Between cuts, the entry describes **HEAD's plugin content while naming the previous release's
commit and version**. That is the residual.

## Measured, five commits, with the production classifier

Each commit's own `packages/plugin` was exported with `git archive` and classified by
`scripts/check-marketplace-pin-digest.mjs` — not by a reimplementation of it:

| commit    | entry version | recorded       | digest(tree@pin) | state                         |
| --------- | ------------- | -------------- | ---------------- | ----------------------------- |
| `cb450e3` | 1.6.0         | `fa13c22c223a` | `fa13c22c223a`   | `at-release`                  |
| `1c85913` | 1.6.0         | `fa13c22c223a` | `d3b18ed68c91`   | `ahead-of-pin`                |
| `b5a609c` | 1.5.0         | `fa13c22c223a` | `d3b18ed68c91`   | `ahead-of-pin` (PR #118)      |
| `2ff3bce` | 1.5.0         | `983414f02e44` | `d3b18ed68c91`   | `ahead-of-pin` (PR #50)       |
| `6b9dd7b` | 1.5.0         | `d3b18ed68c91` | `d3b18ed68c91`   | `at-release` (the v1.5.0 tag) |

`recorded === digest(worktree)` at **all five**. The per-push freshness assertion has never been
violated; the drift is entirely `recorded` versus `digest(tree@pin)`.

## Why nothing said so

The only thing in the repository that looks at the pin at all is
`e2e/release/src/marketplacePinCheck.ts`, whose sole production caller is
`e2e/release/src/releaseGateSummary.ts`. `e2e/release` is **not** a `vitest.config.ts` project, so it
runs in no per-push channel — it evaluates once, at a release cut. The drift therefore surfaced once
per release, in the most expensive place to learn anything.

**And its `digest-neutral-ancestor` tolerance is not what covered this** — a hypothesis worth
falsifying because it is the natural one. That tolerance accepts an ancestor pin whose intervening
diff is confined to `packages/plugin/.claude-plugin/`. Had it run during either drift interval it
would have returned **`mismatched`**: the packaged files changed between `39ef7d1` and `2ff3bce`
include `packages/plugin/statusline/crabgic-statusline.mjs`, and between `39ef7d1` and `b5a609c`
they include `packages/plugin/agents/eo-explore.md`. Neither is inside the excluded path.

## Blast radius — measured, not argued

- **npm.** Every published release is a self-consistent `(version, commit, digest)` triple, because
  the tarball is built at the tag. Recomputing the packaged digest of the shipped `dist/plugin` and
  of the git tree at each entry's pinned commit agrees for both 1.6.0 and 1.5.0. The drift
  structurally cannot reach an npm consumer.
- **`claude plugin marketplace add <path>`.** The digest is fresh for the tree in front of the
  operator. And **nothing in production reads the recorded digest**: the only production consumers of
  `computeContentDigest` are `packages/cli/src/installer/install.ts`,
  `packages/cli/src/installer/upgrade.ts` and
  `packages/cli/src/doctor/checks/capability-manifest-freshness.ts`, and all three recompute from the
  plugin source directory. The recorded field has exactly two readers repo-wide, both test files.
  What the operator does get is main's content wearing the last release's `version` — `version`
  drift, not `digest` drift, and per `docs/engine-baseline.md` §16 that is designed.
- **A GitHub-hosted marketplace.** Does not exist: there is exactly one `marketplace.json` in the
  tree and no root `.claude-plugin/`. **Not claimed:** whether the engine would refuse such an add —
  the baseline does not record it, and it is left UNVERIFIED.

## What was done, and what was refused

**Done.** `scripts/check-marketplace-pin-digest.mjs`, wired as a `meta-checks` step and unit-tested
in the per-push `scripts` vitest project. It names two legal states — `at-release` (silent PASS) and
`ahead-of-pin` (PASS that **prints the drift on every push**) — and blocks on three that nothing
named before: `stale-digest`, `unresolvable-pin`, `non-ancestor-pin`. This is
`docs/verification-playbook.md`'s instruction for a deliberately-open gap: a residual named only in
prose drifts; encode it so it cannot change silently.

**Refused — moving the freshness assertion to release time.** It is the cited bearer of merged
`phase-10.json` criterion 6, whose own text calls it "the load-bearing half of the digest clause" and
records that it "demonstrably bites". Weakening it is a hard-rule-5 situation: stop and report, do
not loosen.

**Refused — storing a second `releasedDigest` field.** It would be a value nothing reads, refreshed
by hand at each cut, going stale silently in between: the same shape `docs/deploy-posture.md` already
records as this project's characteristic failure mode. It is derivable — it is the packaged digest of
the tree at the `commit` the entry already stores — so it is derived, not stored.

## ⚠️ Disclosure — the new check OVERLAPS the assertion it must not weaken

`docs/verification-playbook.md` records that adding a check beside an existing one can silently
un-pin it, coverage migrating between rules with nothing failing. So the overlap was **measured**
rather than assumed, and the numbers are in the evidence transcript:

- hand-edit the recorded digest, freshness assertion **intact**: the plugin suite goes 1 failed / 204
  passed (205) **and** the new suite goes 3 failed / 17 passed (20), CLI exit 1;
- hand-edit the digest **and** delete the freshness assertion: the plugin suite is fully green at
  **204 passed (204)** — the count drops by exactly one, proving the deletion took — while the new
  suite still goes 3 failed / 17 passed (20) and the CLI still exits 1.

So the new check does cover the old one's subject, and the old one is **not** thereby redundant —
though the reason is **thinner than first stated here**. This record originally said the old test
"additionally drives `UnpinnedMarketplaceSchema.parse` … which the new check does not", implying
that path is uniquely borne by it. Measured: `loadUnpinnedMarketplace` is driven from four other
files under `packages/plugin/src`, so a schema regression reddens those too. What is accurate: the
old assertion is the **cited bearer of a merged record** and must not be weakened; the new check
independently covers its digest-freshness subject; neither is grounds for removing the other. Both
files were restored to baseline md5 immediately after the probe. **The old assertion stays exactly
as it is.**

## Residual, stated plainly

`ahead-of-pin` remains an accepted state and will recur the next time a PR touches a packaged plugin
file after a tag. It resolves at each release cut, via the digest-neutral pin process the v1.6.0 cut
used. What has changed is that it now announces itself on every push instead of once per release.

**Evidence:** `docs/evidence/phase-10/marketplace-pin-digest-states.txt`.
