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

## Root cause — isolated 2026-08-18, and the check's own comment is wrong about it

Two independent faults, both now fixed.

**1. The scanner matched prose inside comments.** Its specifier patterns are
`/\bfrom\s*["']…["']/` applied to raw file text, so a JSDoc sentence containing
`from "our region"` is read as an import of a package called `our region`. An UNBUNDLED
`dist` retains its comments; the bundled one does not. That is the whole explanation for
the nonsense list. Block comments are now stripped before matching, and a specifier
containing whitespace — which no package name can — now FAILS the check saying the artifact
is not what it thinks, instead of reporting invented imports.

**2. ⚠️ The comment blames a `prepack` that does not exist.** The check says "`npm pack`
fires packages/cli's `prepack`, which is what replaces `dist`". `packages/cli/package.json`
declares **no `prepack` and no `postpack`**. The bundling is the ROOT `npm run build`
(`tsc -b && npm run bundle:types && npm run bundle:cli`), and nothing fires it during
`npm pack`.

So the real precondition is: **run `npm run build`, not `tsc -b`, before this check.** After
`tsc -b` alone the packed artifact is per-file tsc output that genuinely imports
`@crabgic/*`; after `npm run build` the check passes. Both verdicts were "correct" about
different bytes, which is exactly why quoting either as a fact about `main` was wrong.

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

1. ~~**Assert the artifact before scanning it.**~~ **DONE.** Block comments are stripped
   before matching, and an impossible specifier (one containing whitespace) fails the check
   with what was actually scanned, rather than being reported as a missing dependency.
2. **Correct the stale `prepack` comment** to name `npm run build`. **Effort: XS**, and it
   is the sentence that sent two readers — including this one, twice — to the wrong
   conclusion.
3. **Wire it into CI**, where the checkout is clean and the build is reproducible, so its
   verdict means something about the repository rather than about a laptop. **Effort: XS.**
   Still open: `check:install-smoke` and `check:tarball` remain absent from `ci.yml`.

**Ticket-ready:** yes.

## Not claimed

- **Not claimed** that the published package is broken. When the artifact IS bundled, the
  check passes and says so with a file count.
- **Not claimed** that the scanner is wrong to refuse an undeclared `@crabgic/*` import.
  That rule is correct; what is missing is a precondition on what it is reading.
