# Gap 18 — live verification (2026-07-28)

Run against the **bundled binary** (`npm run bundle:cli`, `packages/cli/dist/bin.js`), not the
test harness, in a throwaway git repository with its own `XDG_STATE_HOME`. Every claim below
was observed, not reasoned about.

## `crabgic install` authors the standing policy

A pty-driven `install` in a repo containing `src/` and a `package.json` declaring `test` and
`build` scripts rendered:

```
  writable paths
    src

  build output it may also write
    dist … node_modules/.cache

  commands
    npm run test
    npm run build
    git status
    git diff

  network destinations
    (none)

  credentials
    (none)

  external resources (Jira, Grafana)
    (none)

  unix sockets: denied
```

Confirmed with `yes`, then `install: installed (repo: clean)` and the six repo artifacts.

**Verified properties:**

- Derivation found `src` from the tree and both grantable `npm run …` prefixes from the
  project's own scripts, and derived **nothing** for network, credentials, remote resources or
  sockets — the four dimensions it deliberately refuses to guess.
- The policy landed at `$XDG_STATE_HOME/crabgic/<project-hash>/envelope-policy.json`, **mode
  `600`**.
- `git status --porcelain` shows the six installer artifacts and **no policy file** — a
  standing grant that could be committed would be a standing grant every clone carried.
- Every dimension is printed including the empty ones. "Nothing" is the most important line on
  that list; omitting it would read as an oversight rather than a denial.

## The managed block carries the operating protocol

The installed `CLAUDE.md` contains the operating protocol and names `AskUserQuestion` and
`/eo:protocol`. This is what the shipped `1.3.0` binary did **not** do — the audit that opened
this work found the globally-installed `1.3.0` writing a capability list with no protocol at
all, because that binary predated it.

## The silent-exit fix holds in the bundle

`crabgic status` against a project with no running daemon now reports

```
could not reach the supervisor control socket: connect ENOENT …/control.sock
```

and exits `71`. Before the fix the same command exited **`0` with no output at all**, which is
how it shipped.

## Not verified here, and owed

No run has been dispatched against a **real engine** end to end. The dispatch gate, the
narrowed sandbox profile and the journaled digest are covered by unit and integration tests
only. The blocker is recorded in `design-roast-round-1.md` (F7): no dependency provisioning
exists for a fresh worktree, so `npm run test` — one of only two grantable build commands —
cannot succeed there at any policy setting. That is the next thing standing between this and a
first real run.

## Live engine verification (2026-07-28, addendum)

The sanctioned `@live` suite (`CRABGIC_LIVE=1`, `vitest.live.config.ts`) run against the
real pinned engine — `claude` **2.1.220**, inside the accepted range.

`packages/plugin/src/live/` — **4/4 green**. The plugin loads via `--plugin-dir` in a real
session; the negative-space assertions hold; and a subagent is genuinely spawnable through
the `Task` tool. That covers this branch's plugin changes — the third subagent, the
protocol block — against the real engine rather than a fixture.

**It found a real defect.** `plugin-load.live.test.ts` failed and then passed on identical
code minutes apart. The prompt ended _"Report only the subagent's finding"_ while the
assertion required the subagent's **name** in the answer: a model that followed the
instruction well answered with the file count alone and failed, while one that padded its
answer passed. Fixed by asking for the name explicitly, so obeying the prompt and
satisfying the assertion are the same act.

Worth recording how that was nearly misdiagnosed: the test passed on `main` and failed on
this branch, which looked like a regression this branch had caused. One sample on each
side does not support that conclusion, and a re-run on the branch passed. A flaky test
compared across two branches reads exactly like a regression.

**Not run:** `packages/engine-claude/src/live/` — nine files that spawn real bounded
workers. Those are a materially larger subscription spend than the plugin subset, and they
verify phase 06's adapter rather than anything this branch changed. A first full run
belongs to the owner.

## Live worker verification (2026-07-28, second addendum)

The `engine-claude` half of the `@live` suite — the nine files that spawn **real bounded
workers** — run against `claude` 2.1.220.

| Suite                                   | Result                      |
| --------------------------------------- | --------------------------- |
| `envelope-conformance`                  | 7/7 ✅ (after a fix, below) |
| `path-anchor`                           | 20/20 ✅                    |
| `crash-recovery`                        | 3/3 ✅ (after a fix, below) |
| `secret-mask`                           | 1/1 ✅                      |
| `adjudication-bridge`                   | 1/1 ✅                      |
| `plugin-load` + `plugin-negative-space` | 4/4 ✅ (after a fix)        |

### Three probes were asserting things the engine does not reliably produce

None was reachable without actually spawning workers.

1. **`envelope-conformance` path-escape** failed with the SDK's _"Reached maximum number of
   turns (4)"_ and passed on a re-run of identical code. Four turns is tight for
   attempt-then-report, and exhausting them made a **security** conformance assertion go
   red for a reason that is no evidence about containment in either direction — a false
   negative in the dangerous direction.
2. **`crash-recovery` fork probe** failed the same way at `maxTurns: 3` — **twice in a row**,
   so not a flake. Three turns cannot cover acknowledge → fork → answer again.
3. **`plugin-load` subagent probe** contradicted itself: its prompt ended _"Report only the
   subagent's finding"_ while the assertion required the subagent's **name** to appear. A
   model that followed the instruction well failed; one that padded its answer passed.

The first two now get a workable budget, and turn exhaustion is re-raised as an explicitly
`INCONCLUSIVE` error naming what it means. The test still fails — what changes is that the
failure no longer misrepresents itself as a capability defect.

### A near-miss worth recording

The plugin probe passed on `main` and failed on this branch, which read exactly like a
regression this branch had caused. One sample on each side does not support that, and a
re-run on the branch passed. **A flaky test compared across two branches is indistinguishable
from a regression** unless you re-sample.
