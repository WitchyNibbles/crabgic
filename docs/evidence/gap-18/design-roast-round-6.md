# Gap 18 — implementation roast, round 6 (2026-07-28)

Round 6 reviewed the round-5 fixes, **by executing them against real fixtures** rather than
reading them. Three of those fixes had made things worse. That is the finding, and it is
recorded first because it is the one that generalises.

## Three regressions, all introduced by a fix

| Round-5 change                                                    | What it actually did                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Restrict `isDirectoryEntry` to symlinks resolving inside the repo | **Cancelled the round-4 fix it was written under.** A repo whose source directories are external links — ordinary with bind mounts and shared monorepos — derived no prefixes, was reported vacuous, and got no policy at all.                                                                                |
| Split the workspace cap evenly between containers                 | **Dropped packages that previously had grants.** Measured: 60 packages + 1 app granted 20 packages where 60 alone granted 40. Twenty packages' `tsc` output silently outside `allowWrite`. Also wasted the budget when one container was small — 3 + 45 granted 23 of 48 with 17 slots unused.                |
| Stop recursing `.bin`                                             | **Strictly worse in the common case.** Round 4 resolved targets (dangling in an unbuilt checkout); round 5 shared the directory wholesale, so every binary resolved to the OWNER's file while `node_modules/<pkg>` beside it correctly resolved to the worktree. Two answers for one package in one worktree. |

None of these was visible by re-reading the diff. All three needed a reviewer who ran the
code and **measured the outcome against the previous behaviour** — the even-split test, for
instance, passed at 20/45 and would have passed at 1/45.

## Also fixed

- **`isUsablePathPrefix` vs the containment normalizer: 113 mismatches**, found by brute-forcing
  17,476 prefixes. Every one needed a whitespace-leading first segment — `"./ ~"` slipped
  the tilde check round 5 had _just_ added, because `normalizePath` re-trims and this did
  not. Segments are now trimmed before anything is decided about them.
- **A directory at the policy path was refused for the wrong reason.** Default umask gives
  0755, so the mode check fired first and reported "accessible to other accounts (mode
  655)" — a mode the directory does not have — leaving the specific message reachable only
  for a 0700 directory nobody creates by accident.
- **The open-path message asserted the file exists** when an unreadable _parent_ raises
  `EACCES` whether or not a policy is there — misdiagnosing in the opposite direction from
  the bug it was written to fix.
- **"Inside the repository" was not a sufficient bound**, because the repository contains
  `node_modules` — which this system's own provisioner fills with links back to the owner's
  checkout. A tracked `docs -> node_modules` reached the source tree two hops later.

## Attacked and could not break

- The cap **cannot** exceed `MAX_WORKSPACE_PACKAGES`.
- `isDirectoryEntry` with a symlinked _parent_ (symlinked project dir, container, or repo
  root reached through a symlinked `~/dev`) answers correctly — both sides use `realpathSync`.
- `isUsablePathPrefix` in the reverse direction: **zero** rejected-but-normalizable
  mismatches across the corpus.
- No `policy-store` read-path error that should be `absent`; deleting the file between open
  and read still reads correctly from the descriptor.
- `resolveLinkTarget`'s dangling branch now matches its sibling; no relative target survives.
- Determinism: the sort plus fixed constant ordering makes the derived policy and its digest
  machine-independent, as claimed.

## What six rounds have shown

Rounds 1–3 found defects in code written once. Rounds 4–6 increasingly found defects **in
fixes** — a fix applied to one return and not its sibling, a constant updated in one package
and not its consumer, and three fixes that were net-negative. The loop's value did not decay
as the code improved; it changed shape. That is the argument for the termination rule being
"a round finds nothing new and falsifiable" rather than a fixed number of rounds.
