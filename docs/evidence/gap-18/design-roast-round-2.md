# Gap 18 — implementation roast, round 2 (2026-07-28)

Round 1 roasted the _design_; this round roasted the _code_ — `EnvelopePolicy`,
`isContained` and `createRun` as committed. A fresh reviewer that neither authored them
nor saw round 1's verdict, per ledger Gap 19 part 5, and explicitly told which round-1
findings were already known so it could not extend the loop by restating them.

It extends the loop: novel, falsifiable findings at every severity. Several were
**demonstrated by running them**, not argued.

## Confirmed sound — recorded so they are not re-litigated

The reviewer was asked to break three specific claims and could not:

- **The post-validation `.`/`""` collapse cannot escape via `..`.** `validateOwnedPath`
  checks `..` on the _trimmed_ string _before_ the trailing-slash strip, so `"src/../"`,
  `"./.."`, `"./src/../etc"` and `"../"` all throw before any collapsing happens.
- **The two-sided `trim` opens nothing.** Both sides call `String.trim`, so unicode
  whitespace is symmetric and zero-width space is trimmed by neither.
- **No envelope passes containment and compiles outside the policy prefix.** Every emitted
  entry is anchored at `//${WORKTREE_WRITE_PLACEHOLDER}/`, and `validateOwnedPath` rejects
  absolute, `~`, `..` and glob forms, so escaping is structurally impossible.

## Fixed in this round

| #   | Sev          | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Status                                                                                                                                               |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **CRITICAL** | **TOCTOU, proven.** Both guards were read before the first `await` while the in-flight claim was written after it. Two concurrent `run.dispatch` on one change set each saw an empty claim set and empty registry and **both created a run** — two live runs over the same work units and worktrees, no review. `runs.list()` returned two `running` records for one changeSetId. The UDS server serializes per connection only, so two connections was the whole exploit. | **Fixed** — claim taken synchronously, released in `finally`. Regression test **mutation-checked**: restoring the old ordering fails it.             |
| F2  | **HIGH**     | **`ready` is a reusable dispatch ticket.** Nothing ever moves a `ChangeSet` out of `ready` — the dispatch/drive path never writes one — so once a run reaches `published_local` and settles, dispatching again mints a second run that re-executes and **re-publishes** finished work unreviewed.                                                                                                                                                                          | **Fixed** — `findPublishedRunForChangeSet` refuses re-dispatch after a publish. Retry after `failed`/`blocked`/`cancelled` deliberately still works. |
| F4  | **HIGH**     | **A malformed policy prefix is misdiagnosed as an envelope fault.** `allowedPathPrefixes: ["src/**"]` — the natural way to write "everything under src" — parses, is not vacuous, passes every structural doctor check, matches nothing for ever, and reported `owned path "src/login" is not at or below any allowed path prefix`. The owner is sent to fix the wrong file, at a gate they must edit out-of-band.                                                         | **Fixed** — unusable prefixes are reported first, naming the policy.                                                                                 |
| F5  | **HIGH**     | **Surviving mutation:** the ChangeSet-state guard was tested on 2 of 11 states. Rewriting `state !== "ready"` as `state === "draft" \|\| state === "awaiting_approval"` left **38/38 passing** while dispatching `cancelled`, `blocked`, `failed` and `published_local`.                                                                                                                                                                                                   | **Fixed** — `it.each` over every member of the union.                                                                                                |
| F8  | **MEDIUM**   | **Surviving mutation:** no interior-`//` case existed (`validateOwnedPath` strips only _trailing_ slashes), so dropping the `segment !== ""` filter left 38/38 passing.                                                                                                                                                                                                                                                                                                    | **Fixed** — covered.                                                                                                                                 |
| F9  | **MEDIUM**   | **Postcondition break.** The collapse could return a string `validateOwnedPath` itself rejects: `"./~"` → `"~"`, `"./~/.ssh"` → `"~/.ssh"`, re-creating the home-anchored form. Not exploitable against a well-formed policy, but "safe by construction" argued only about `..` and so overclaimed. Separately, mutating the empty-result guard left 38/38 passing.                                                                                                        | **Fixed** — the collapsed result is re-validated; both cases covered.                                                                                |
| F7  | **MEDIUM**   | **Surviving mutation:** deleting both `.trim()` calls in `exactlyContained` left 38/38 passing — no test ever passed an untrimmed value.                                                                                                                                                                                                                                                                                                                                   | **Covered.** The asymmetry it reveals is recorded below rather than fixed.                                                                           |

## Open, recorded rather than fixed

- **F3 — lost update in `transitionRun` (proven).** It reads `from` before `await
appendEntry` and upserts after: a classic read-modify-write across an await, and
  `createRun` performs three of them. A `run.cancel` racing the walk produced a journal
  containing `{from:"ready",to:"cancelled"}` **and** `{from:"ready",to:"running"}` — two
  outgoing edges from one state, in the record the module's own doc calls the audit
  record — while `createRun` returned `running` and launched workers and the operator was
  told `cancelled`. Which value survives is decided by filesystem append order. This is
  **pre-existing** (`transitionRun` predates Gap 18) and affects `haltOnStopCondition`
  identically. It needs a serialization primitive around run-lifecycle writes, not a
  patch at one call site.
- **F6 — same-`runId` concurrency defeats the transition table.** Two concurrent
  `createRun` with the same caller-supplied `runId` both fulfil and journal the whole walk
  twice. Not reachable from `dispatch` (which uses `randomUUID`), but `CreateRunOptions.runId`
  invites caller-supplied ids. Same root cause as F3.
- **F7 (residual) — trim asymmetry with the compiler.** Containment trims;
  `sandbox-profile.ts` does not. A padded `" JIRA_TOKEN "` is judged contained against a
  policy's `"JIRA_TOKEN"` but compiled as `envVars: [{ name: " JIRA_TOKEN " }]`. Fails
  closed (the variable will not resolve), but the gate approved an identity that is not
  the one that runs. Also: comparison is byte-exact while DNS is case-insensitive, and the
  trailing-dot FQDN form is a distinct value a policy must list separately.
- **F10 — a file-shaped owned path grants nothing.** `ownedPaths: ["src/config.json"]`
  under policy `["src"]` is contained, and compiles to `Edit(//<wt>/src/config.json/**)` —
  a `/**` under a regular file, matching nothing. The worker is approved to own a file and
  receives write authority over zero paths. Mirror image: `ownedPaths: ["."]` is refused by
  containment while compiling to a whole-worktree grant. Both fail closed, but under
  standing approval there is no human left to notice the worker cannot write what it was
  granted.
