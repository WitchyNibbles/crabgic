# 23 — the npm-name re-check has no verdict word for "the name is ours and this version is free"

**Phase:** 23 — E2E matrix, security review, packaging, publication
(`roadmap/23-release-hardening.md`)

**Found:** 2026-08-07, preparing the v1.6.0 cut. The check was written before the first publish, and
the world it was written for stopped existing at `crabgic@1.0.0`.

## Gap

`e2e/release/src/npmNameRecheck.ts` scores the `npm view crabgic re-check passes` clause of the
reproducible-build exit criterion. It reads `docs/release-notes-prep.md` for a
`Verdict: available|taken … as of <ISO-8601>` on one line and applies two rules:

- `e2e/release/src/npmNameRecheck.ts:42` — `export const NPM_NAME_RECHECK_MAX_AGE_DAYS = 7;`, so a
  recorded verdict older than seven days is a blocking reason.
- `e2e/release/src/npmNameRecheck.ts:166` — `if (!verdictAvailable) {`, whose reason at
  `e2e/release/src/npmNameRecheck.ts:176` reads
  `the recorded verdict for "${options.packageName}" is taken (as of ${recordedAt}) — ` and at
  `e2e/release/src/npmNameRecheck.ts:177` `claiming the name is a product decision for the owner, not a retry`.

Both reasons are folded into the composed gate verdict at
`e2e/release/src/releaseGateSummary.ts:391`, so either one fails the `reproducible-build` item.

The vocabulary is exactly two words, and neither describes the post-first-publish state:

- `taken` was minted to mean **somebody else** claimed the name. Writing it now — when the name is
  genuinely no longer unclaimed — fails the gate outright and escalates a non-existent product
  decision.
- `available` was minted at `docs/release-notes-prep.md:9`
  (`**Verdict: available (unclaimed) as of 2026-07-26T18:11:17Z.**`) to mean **no package has ever
  been published under this name**. That reading has been false since v1.0.0.

The state a release-time re-check actually needs to assert — _the name resolves to this project's own
package, and the version about to be cut is unclaimed on the registry_ — cannot be written down. It
is a two-value enum being asked a three-value question.

## Why it matters rather than being pedantry

The check is not decorative: it is the only thing that distinguishes a release-time re-check from a
year-old record, and `scripts/check-release-notes.mjs` (a regex in `meta-checks` asserting only that
_some_ timestamp and _some_ verdict word appear anywhere in the file) will pass forever regardless.
So the honest verdict word is load-bearing, and the only honest one available is `available` under a
redefinition the check itself does not know about.

That redefinition is now written beside the verdict at
`docs/release-notes-prep.md:79` and explained in the same section. **It is prose, and the check
cannot read it.** A future pass that writes `Verdict: available` without repeating the redefinition
produces a record whose word means the 2026-07-26 thing to any reader who does not scroll — which is
the declared-and-inert failure shape this repository keeps re-finding, applied to a verdict word
instead of a config field.

## What was NOT done, deliberately

The tool was **not** tuned green and the window was **not** widened. Per the playbook's ruling that a
sweeper flagging something honest gets its rule softened to report that shape rather than silenced,
the remedy belongs in the vocabulary, not in the threshold.

## Remedy

**S.** Add a third verdict word — `owned` is the obvious spelling — meaning "the name resolves to
this project's own package and the version being cut is unclaimed", and have the check treat it as
passing while `taken` keeps its existing meaning and its existing refusal. Two additional
obligations, because a wider vocabulary without them is a wider hole:

1. The pattern at `e2e/release/src/npmNameRecheck.ts:60` binds verdict and timestamp as one unit
   precisely so an unrelated timestamp cannot dress up a stale record. A third word must be added
   inside that same pattern, never as a second independent scan.
2. `owned` asserts something about the _version_, which `available`/`taken` do not, so the record
   format should carry the version being cut and the check should assert it matches
   `packages/cli/package.json` — otherwise the new word is satisfiable by a re-check run for a
   different release.

Needs no live engine, no Docker and no owner subscription. The wording of the word itself is an
owner call, which is why this record is filed rather than the change being made inside a release cut.
