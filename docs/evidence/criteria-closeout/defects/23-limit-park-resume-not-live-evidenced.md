# Defect 23-limit-park-resume-not-live-evidenced

**Phase:** 23 — Release hardening & publication (`roadmap/23-release-hardening.md`, exit criterion 6)

**Criterion (verbatim):**

> Crash-recovery and concurrent change-set E2E scenarios pass live, including limit-parked resume across a supervisor restart (05/13).

**Found:** 2026-08-04, criteria-closeout pass (phase 23), at
`3dec9bf2caa6b94bd817aee414f9458c37750fd9`.

**Severity:** evidence-channel-first, with a real product tail. The crash-recovery and parking
semantics are exercised end to end against the real scheduler, the real supervisor recovery path and
a real on-disk journal, so the arc itself is well proven. What is missing is the word the criterion
uses — **live** — and, unlike a pure channel gap, closing it needs work as well as authorisation:
the repository's own live probe declines the cross-process daemon restart by design.

## Gap

Four conjuncts. Three are met; one is not.

| Conjunct                                        | Status at `3dec9bf`                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| crash recovery (worker and manager)             | **met** — `e2e/matrix/orchestration/test/{worker,manager}-crash-recovery.test.ts`, real `recoverRun`  |
| concurrent change sets                          | **met** — `independent-parallel`, `dependent-serialization`, `target-drift`, `cancellation` scenarios |
| limit-parked resume across a supervisor restart | **met in substance** — `limit-parked-resume-restart.test.ts`, 2 scenarios, real parking state machine |
| ...**live**                                     | **not met** — every one of the above drives `@crabgic/testkit`'s `FakeEngineAdapter`                  |

### Measurement trail

Full transcript: `docs/evidence/phase-23/closeout/c6-c7-live-gap.txt` (UTC-stamped, HEAD-pinned,
every command echoed with its own exit status).

The harness declares its own scope, at `e2e/matrix/orchestration/vitest.config.ts`:

<!-- prettier-ignore-start -->

```text
 * Every scenario here drives the REAL `@crabgic/scheduler` executor
 * (`dispatchAttempt`/`resumeAttempt`) and the REAL `@crabgic/supervisor`
 * `recoverRun` against the FAKE engine (`@crabgic/testkit`'s `FakeEngineAdapter`)
 * over a real `@crabgic/journal` `JournalStore` on a real temp directory — no
 * network, no real Claude Code engine, no live Docker daemon, so this gate
 * is fast and safe to run anywhere, including CI.
```

<!-- prettier-ignore-end -->

Two further measurements sharpen it:

| Check                                                                         | Result at `3dec9bf`                                                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| any process API (`child_process`/`spawnSync`/`execFile`/`.fork(`) in the lane | **no match** (`exit=1`) — the "supervisor restart" is not a process restart        |
| what the restart actually is                                                  | `reopenJournal(journalDir)`, a fresh `JournalStore` over the same directory        |
| the scenario clock                                                            | an injected `nowSeconds` epoch integer; the suite "NEVER real-sleeps"              |
| committed transcripts mentioning `parked:rate_limit` under `docs/evidence/`   | all fake-engine; the nearest names itself "simulated supervisor restart" on line 1 |
| total runs, ever, of `engine-live.yml`                                        | **0**                                                                              |

### Why the live channel would not close this as it stands

`packages/engine-claude/src/live/parked-resume-write-authority.live.test.ts:31-44` — the only live
park/resume probe in the repository — excludes, by design, precisely the two things this criterion
needs:

<!-- prettier-ignore-start -->

```text
 *   - The cross-process / cross-adapter-instance resume (a daemon RESTART):
 *     `spawnContexts` is in-memory per adapter, so a restart hits
 *     `FALLBACK_SPAWN_CONTEXT` and degrades to READ_ONLY by design.
 *   - Forcing a REAL rate-limit park: a `rejected` limit event has never been
 *     observed live (baseline §8; `rate-limit-fixtures.ts`) ...
```

<!-- prettier-ignore-end -->

So authorising `engine-live` today would not produce the evidence; the probe has to be extended
first, and a rate-limit park has to be induced rather than waited for.

### The phase's own words

`roadmap/23` §Test plan's Sessions row reads "Kill -9 → resume, and parking-across-restart, **both
live**", and §Goal requires every release-gate item to be backed by a record "from a live or
containerized run of the release-candidate object ID — never a fake-engine substitute". This is not
a strict reading imported from outside; it is the phase's own standard.

### Aggravating fact — matrix evidence ages

Two post-gate fixes touch exactly this production surface: **#51** (publish a lease with its
contents, so two processes cannot both hold it — `packages/journal/src/lease-acquire.ts`) and **#67**
(settle a run whose DAG ended in failure instead of wedging it in `running`). Both landed after the
v1.5.0 gate, so the crash-recovery evidence the release rests on was produced by a tree that still
contained them. That is the concrete argument for chaining the matrix into every tag — which
`publish.yml` now does — and for not treating a single dated gate run as permanent.

## Proposed remedy

1. **Extend the live park/resume probe** so a resume can survive a real adapter restart: persist
   enough spawn context for a re-created adapter to re-establish write authority, rather than
   falling back to `READ_ONLY`. This is the product work, and it is what makes the rest possible.
2. **Induce a park deterministically under `CRABGIC_LIVE=1`** — either by driving the real
   rate-limit signal shape from `docs/engine-baseline.md` §8's fixture through the live transport, or
   by an explicit test-only limit injection at the adapter seam.
3. **Extend `engine-live.yml`** with the park→restart→resume scenario and dispatch it once, with the
   owner's approval, recording the transcript under `docs/evidence/phase-23/`.
4. Then re-score criterion 6 citing that run alongside the existing orchestration matrix.

**Effort: M.** Step 1 is a bounded change to spawn-context persistence; steps 2–4 are small once it
lands. The harness, the journal, the parking state machine and the CI job all already exist.

**Needs:** owner authorisation and the owner's paid Claude subscription (step 3 is the one live
dispatch). **Does not need** Docker or any connector credentials.

**Ticket-ready:** yes.
