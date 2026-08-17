# 25 — `check:install-smoke`'s verdict depends on local `dist` state, and it is not in CI

**Phase:** cross-cutting. Surface: `scripts/check-install-smoke.mjs`.

**Found:** 2026-08-18, after the check produced three different verdicts in one session on
one working tree.

**Severity: low as a product risk, HIGH as an evidence risk.** Nothing ships wrong. What
goes wrong is that the check is quoted as evidence about `main`, and it is not measuring
`main`.

## What happens

The same command, on the same branch, in one session:

| when                                       | verdict                                              |
| ------------------------------------------ | ---------------------------------------------------- |
| mid-edit, workspace `dist` partly rebuilt  | FAIL — "imports @crabgic/gates, @crabgic/supervisor" |
| after a full `tsc -b`                      | **PASS** — 130 files, then 37, then 45               |
| after `rm -rf packages/cli/dist && tsc -b` | FAIL — with nonsense "package names"                 |

The third failure is the diagnostic one. Its list of undeclared imports contains prose:

```
this provider, @crabgic/gates, @crabgic/scheduler, …, unreachable, @crabgic/plugin,
failed because the directory is gone, our region, this project may talk to any network
destination without review, absent
```

"our region" and "failed because the directory is gone" are STRING LITERALS from the
source. The import scanner is reading an unbundled `dist` and extracting fragments of
prose as module specifiers.

**Reproduced identically on clean `main`** in a separate git worktree with its own build —
so it is a property of the check, not of any branch.

## Root cause

The check's own comment says `npm pack` fires `packages/cli`'s `prepack`, "which is what
replaces `dist`". When the workspace `dist` is in a state where that bundling does not
produce the published artifact, the scanner runs over the wrong bytes and reports whatever
it finds. It has no assertion that what it scanned is a bundle.

⚠️ **And it does not run in CI.** `check:install-smoke` and `check:tarball` are members of
`check:all` but are absent from `.github/workflows/ci.yml`, so nothing measures this on a
clean checkout.

## Why this is filed as an EVIDENCE defect

This check's verdict was quoted twice, in the bodies of merged PRs #144 and #145, as
"fails on `main`, verified pre-existing". Both claims were wrong: the measurement was of a
mid-build local `dist`, and the attribution used `git stash`, which does not revert
untracked build output. A check whose answer depends on uncommitted build state will be
misquoted by anyone who does not already know that.

## Remedy

1. **Assert the artifact before scanning it.** If the packed `dist` is not the bundled
   output `prepack` produces, the check should FAIL saying so, rather than scanning it and
   reporting invented imports. **Effort: S.**
2. **Wire it into CI**, where the checkout is clean and the build is reproducible, so its
   verdict means something about the repository rather than about a laptop. **Effort: XS.**

**Ticket-ready:** yes.

## Not claimed

- **Not claimed** that the published package is broken. When the artifact IS bundled, the
  check passes and says so with a file count.
- **Not claimed** that the scanner is wrong to refuse an undeclared `@crabgic/*` import.
  That rule is correct; what is missing is a precondition on what it is reading.
